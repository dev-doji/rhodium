import { describe, it, expect } from "vitest";
import { BANKS, bankCodeFor, findBank, pickBank } from "../src/modules/whatsapp/banks.js";

/**
 * There is no single national bank code. NIBSS codes are what OnSwitch and
 * Monnify want; Paystack has its own scheme and rejects anything else with a
 * bare 400. The old list held only NIBSS codes, so once the fiat provider
 * became Paystack every subaccount creation failed — and because onboarding
 * logs that failure and carries on, merchants looked fully set up and simply
 * could not be paid. Tees Kitchen onboarded, listed a product, and only found
 * out at checkout.
 */

describe("bank codes are per provider", () => {
  it("gives Paystack its own scheme, not the NIBSS one", () => {
    // The specific values that were being rejected.
    expect(bankCodeFor("paystack", "opay")).toBe("999992");
    expect(bankCodeFor("paystack", "access")).toBe("044");
    expect(bankCodeFor("paystack", "moniepoint")).toBe("50515");
  });

  it("gives OnSwitch the NIBSS scheme for the same banks", () => {
    expect(bankCodeFor("nibss", "opay")).toBe("100004");
    expect(bankCodeFor("nibss", "access")).toBe("000014");
  });

  it("never returns the same code to both providers for a bank", () => {
    // If these ever coincide the translation is doing nothing and the bug is
    // back without any test failing.
    for (const b of BANKS) {
      expect(b.codes.paystack, `${b.name} paystack`).toBeTruthy();
      expect(b.codes.nibss, `${b.name} nibss`).toBeTruthy();
      expect(b.codes.paystack, `${b.name} looks untranslated`).not.toBe(b.codes.nibss);
    }
  });

  it("still understands merchants onboarded before this existed", () => {
    // Their settlementBankCode holds a raw NIBSS code, and it must resolve to
    // the right Paystack code rather than being passed through and rejected.
    expect(bankCodeFor("paystack", "100004")).toBe("999992");
    expect(bankCodeFor("paystack", "000014")).toBe("044");
    expect(findBank("100004")?.id).toBe("opay");
  });

  it("passes through a bank we do not menu, so the provider decides", () => {
    // A merchant may legitimately bank somewhere absent from a curated list;
    // refusing it ourselves would be worse than letting the provider answer.
    expect(bankCodeFor("paystack", "123456")).toBe("123456");
  });
});

describe("choosing a bank in the chat", () => {
  it("accepts the list number", () => {
    expect(pickBank("1")?.id).toBe(BANKS[0]!.id);
  });

  it("accepts a name people actually type", () => {
    expect(pickBank("opay")?.id).toBe("opay");
    expect(pickBank("Moniepoint")?.id).toBe("moniepoint");
  });

  it("refuses an empty or unknown reply rather than guessing", () => {
    // A silent wrong guess here sends someone's money to another bank.
    expect(pickBank("")).toBeNull();
    expect(pickBank("   ")).toBeNull();
    expect(pickBank("Bank of Nowhere")).toBeNull();
  });

  it("every menu entry survives a round trip to a provider code", () => {
    for (let i = 0; i < BANKS.length; i++) {
      const picked = pickBank(String(i + 1))!;
      expect(bankCodeFor("paystack", picked.id)).toBe(picked.codes.paystack);
    }
  });
});
