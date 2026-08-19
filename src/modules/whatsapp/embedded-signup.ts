import type { Repositories } from "../../db/repositories.js";
import type { Merchant } from "../../domain/types.js";
import { hmacSign, hmacVerify } from "../../lib/crypto.js";
import { logger } from "../../lib/logger.js";
import { ValidationError } from "../../lib/errors.js";

const log = logger("whatsapp-signup");

export interface EmbeddedSignupConfig {
  appId: string;
  appSecret: string;
  configId: string;
  redirectUri: string;
  /** Signs the OAuth `state` so a callback can't be pointed at another merchant. */
  stateSecret: string;
  graphBase?: string;
  dialogBase?: string;
}

export interface ConnectedNumber {
  merchantId: string;
  waPhoneNumberId: string;
  waBusinessAccountId: string;
  displayPhone?: string;
}

/**
 * WhatsApp Embedded Signup (Independent Tech Provider).
 *
 * The vendor authorises Rhodium against their own WhatsApp Business Account;
 * Meta redirects back here with a `code`. We exchange it for a short-lived
 * business token, read which WABA + phone number it grants, subscribe our app
 * to that WABA (so their inbound messages reach our webhook), and record the
 * `phone_number_id` on the merchant. Everything downstream keys off that id.
 *
 * The vendor's token is deliberately NOT stored. Under tech-provider
 * onboarding, sharing the WABA with our app is what grants our own system-user
 * token access to send on their number, so their token has no use after
 * onboarding and storing it would only be a liability.
 */
export class EmbeddedSignupService {
  private graphBase: string;
  private dialogBase: string;

  constructor(
    private repos: Repositories,
    private cfg: EmbeddedSignupConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {
    this.graphBase = cfg.graphBase ?? "https://graph.facebook.com/v21.0";
    this.dialogBase = cfg.dialogBase ?? "https://www.facebook.com/v21.0/dialog/oauth";
  }

  get configured(): boolean {
    return Boolean(this.cfg.appId && this.cfg.appSecret && this.cfg.configId);
  }

  /**
   * The link a vendor taps to connect their number. `state` binds the flow to
   * this merchant and is HMAC-signed, because the callback is a public URL with
   * no session behind it — an unsigned merchant id there would let anyone
   * attach their number to someone else's shop.
   */
  signupUrl(merchantId: string): string {
    const params = new URLSearchParams({
      client_id: this.cfg.appId,
      config_id: this.cfg.configId,
      redirect_uri: this.cfg.redirectUri,
      response_type: "code",
      override_default_response_type: "true",
      state: this.signState(merchantId),
    });
    return `${this.dialogBase}?${params.toString()}`;
  }

  signState(merchantId: string): string {
    return `${merchantId}.${hmacSign(merchantId, this.cfg.stateSecret)}`;
  }

  verifyState(state: string): string {
    const idx = state.lastIndexOf(".");
    const merchantId = idx > 0 ? state.slice(0, idx) : "";
    const signature = idx > 0 ? state.slice(idx + 1) : "";
    if (!merchantId || !hmacVerify(merchantId, signature, this.cfg.stateSecret)) {
      throw new ValidationError("invalid signup state");
    }
    return merchantId;
  }

  /** Full callback handling: code → token → WABA + number → merchant updated. */
  async completeSignup(code: string, state: string): Promise<ConnectedNumber> {
    const merchantId = this.verifyState(state);
    const merchant = await this.repos.merchants.byId(merchantId);
    if (!merchant) throw new ValidationError("unknown merchant in signup state");

    const token = await this.exchangeCode(code);
    const wabaId = await this.resolveWabaId(token);
    const number = await this.resolvePhoneNumber(wabaId, token);
    await this.subscribeApp(wabaId, token);

    return this.attachNumber(merchant, {
      waPhoneNumberId: number.id,
      waBusinessAccountId: wabaId,
      displayPhone: number.displayPhone,
    });
  }

  /**
   * Record a number against a merchant. Split out from `completeSignup` because
   * while Meta review is pending the number is added to our WABA by hand, and
   * the demo still needs a way to make that merchant multi-tenant.
   */
  async attachNumber(
    merchant: Merchant,
    number: { waPhoneNumberId: string; waBusinessAccountId?: string; displayPhone?: string },
  ): Promise<ConnectedNumber> {
    const clash = await this.repos.merchants.byWaPhoneNumberId(number.waPhoneNumberId);
    if (clash && clash.id !== merchant.id) {
      throw new ValidationError("that WhatsApp number is already connected to another shop");
    }
    await this.repos.merchants.update(merchant.id, {
      waPhoneNumberId: number.waPhoneNumberId,
      waBusinessAccountId: number.waBusinessAccountId,
      waDisplayPhone: number.displayPhone,
    });
    log.info(
      { merchantId: merchant.id, waPhoneNumberId: number.waPhoneNumberId },
      "vendor number connected",
    );
    return {
      merchantId: merchant.id,
      waPhoneNumberId: number.waPhoneNumberId,
      waBusinessAccountId: number.waBusinessAccountId ?? "",
      displayPhone: number.displayPhone,
    };
  }

  // --- Graph calls -----------------------------------------------------------

  private async exchangeCode(code: string): Promise<string> {
    const params = new URLSearchParams({
      client_id: this.cfg.appId,
      client_secret: this.cfg.appSecret,
      redirect_uri: this.cfg.redirectUri,
      code,
    });
    const body = await this.graph<{ access_token?: string }>(
      `/oauth/access_token?${params.toString()}`,
    );
    if (!body.access_token) throw new ValidationError("no access_token in code exchange");
    return body.access_token;
  }

  /**
   * Which WABA did the vendor just grant? `debug_token` reports it under the
   * granular scope for whatsapp_business_management — this is the documented
   * way to learn the id, since the code exchange itself returns only a token.
   */
  private async resolveWabaId(token: string): Promise<string> {
    const body = await this.graph<{
      data?: { granular_scopes?: { scope: string; target_ids?: string[] }[] };
    }>(`/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`);
    const scopes = body.data?.granular_scopes ?? [];
    const waba = scopes.find((s) => s.scope === "whatsapp_business_management")?.target_ids?.[0];
    if (!waba) throw new ValidationError("signup granted no WhatsApp Business Account");
    return waba;
  }

  private async resolvePhoneNumber(
    wabaId: string,
    token: string,
  ): Promise<{ id: string; displayPhone?: string }> {
    const body = await this.graph<{
      data?: { id: string; display_phone_number?: string }[];
    }>(`/${wabaId}/phone_numbers`, token);
    const first = body.data?.[0];
    if (!first?.id) throw new ValidationError("no phone number on the connected account");
    return { id: first.id, displayPhone: first.display_phone_number };
  }

  /**
   * Subscribe OUR app to the vendor's WABA — without this their inbound
   * messages never reach `/webhooks/whatsapp` and the whole tenant is silent.
   * Non-fatal: a number added to our own WABA by hand is already subscribed.
   *
   * NOTE: this subscribes the app to the WABA; WHICH webhook fields we receive
   * is an app-level setting, not a per-WABA one, so it cannot be set from here.
   * For Coexistence (vendor keeps her WhatsApp Business app on the same number)
   * these must be ticked in App Dashboard → WhatsApp → Configuration:
   *   • `messages`            — normal inbound (already on)
   *   • `smb_message_echoes`  — her manual replies; drives human takeover
   *   • `history`             — up to 6 months of prior chat
   *   • `smb_app_state_sync`  — her contacts
   * Without `smb_message_echoes` the bot cannot tell she has answered by hand,
   * and every buyer gets two replies.
   */
  private async subscribeApp(wabaId: string, token: string): Promise<void> {
    try {
      await this.graph(`/${wabaId}/subscribed_apps`, token, "POST");
    } catch (err) {
      log.warn({ wabaId, err: (err as Error).message }, "subscribed_apps failed");
    }
  }

  private async graph<T>(path: string, token?: string, method: "GET" | "POST" = "GET"): Promise<T> {
    const res = await this.fetchImpl(`${this.graphBase}${path}`, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await res.text();
    if (!res.ok) {
      log.error({ path: path.split("?")[0], status: res.status, text }, "graph call failed");
      throw new ValidationError(`WhatsApp signup failed (${res.status})`);
    }
    return JSON.parse(text) as T;
  }
}
