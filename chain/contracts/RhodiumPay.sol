// SPDX-License-Identifier: MIT
// Quai buildathon: Solidity is capped at 0.8.20 — pragma pinned exactly.
pragma solidity 0.8.20;

/**
 * RhodiumPay — a no-custody payment forwarder for Quai Network (EVM-compatible).
 *
 * The buyer pays THROUGH this contract, which forwards funds to the merchant in
 * the SAME transaction and emits a Paid event carrying the Rhodium orderId. The
 * contract never holds a balance between calls — this is the crypto twin of the
 * bank-transfer DVA: funds settle merchant-direct, Rhodium is never a custodian.
 *
 * `orderId` in the event is how Rhodium matches an on-chain payment to an order
 * (the analogue of the DVA account number in the fiat rail).
 */
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract RhodiumPay {
    event Paid(
        bytes32 indexed orderId,
        address indexed merchant,
        address token, // address(0) = native QUAI
        uint256 amount,
        address payer
    );

    /// Pay a naira-priced order in native QUAI; forwarded to the merchant.
    function payNative(bytes32 orderId, address payable merchant) external payable {
        require(msg.value > 0, "no value");
        require(merchant != address(0), "bad merchant");
        (bool ok, ) = merchant.call{value: msg.value}("");
        require(ok, "forward failed");
        emit Paid(orderId, merchant, address(0), msg.value, msg.sender);
    }

    /// Pay in an ERC-20 stablecoin (e.g. USDT); moved buyer -> merchant directly.
    function payToken(
        bytes32 orderId,
        address merchant,
        address token,
        uint256 amount
    ) external {
        require(merchant != address(0), "bad merchant");
        require(amount > 0, "no amount");
        require(IERC20(token).transferFrom(msg.sender, merchant, amount), "transfer failed");
        emit Paid(orderId, merchant, token, amount, msg.sender);
    }
}
