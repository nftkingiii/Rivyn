// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @notice Sepolia source contract. The buyer's transaction is later proven on Creditcoin through Attestcoin.
contract InvoiceApprovalRegistry {
    error InvalidInvoiceId();
    error InvalidPayee();
    error InvalidAmount();
    error ApprovalAlreadyRecorded();

    mapping(bytes32 approvalKey => bool approved) public approvals;

    event InvoiceApproved(bytes32 indexed invoiceId, address indexed buyer, address indexed payee, uint256 amount);

    function approveInvoice(bytes32 invoiceId, address payee, uint256 amount) external {
        if (invoiceId == bytes32(0)) revert InvalidInvoiceId();
        if (payee == address(0) || payee == msg.sender) revert InvalidPayee();
        if (amount == 0) revert InvalidAmount();

        bytes32 approvalKey = keccak256(abi.encode(invoiceId, msg.sender));
        if (approvals[approvalKey]) revert ApprovalAlreadyRecorded();
        approvals[approvalKey] = true;

        emit InvoiceApproved(invoiceId, msg.sender, payee, amount);
    }
}
