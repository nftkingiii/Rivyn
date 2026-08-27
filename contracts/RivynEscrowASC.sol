// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { EvmV1Decoder } from "@gluwa/usc-contracts/contracts/decoding/EvmV1Decoder.sol";
import { INativeQueryVerifier, NativeQueryVerifierLib } from "./VerifierInterface.sol";

/// @notice Creditcoin escrow whose release is conditioned on a verified Sepolia invoice approval.
contract RivynEscrowASC is ReentrancyGuard {
    enum InvoiceStatus {
        None,
        Funded,
        Released,
        Refunded
    }

    struct Invoice {
        address funder;
        address buyer;
        address payable payee;
        uint128 amount;
        uint64 expiresAt;
        InvoiceStatus status;
    }

    error InvalidSourceContract();
    error InvalidInvoice();
    error InvalidParty();
    error InvalidAmount();
    error InvalidExpiry();
    error InvoiceAlreadyExists();
    error InvoiceNotFunded();
    error InvoiceNotExpired();
    error OnlyFunder();
    error UnsupportedSourceChain();
    error QueryAlreadyProcessed();
    error ProofVerificationFailed();
    error UnsupportedTransactionType();
    error SourceTransactionFailed();
    error MatchingApprovalNotFound();
    error EncodedTransactionTooLarge();
    error TransferFailed();

    uint64 public constant SEPOLIA_CHAIN_KEY = 1;
    uint256 public constant MAX_ENCODED_TRANSACTION_BYTES = 256 * 1024;
    bytes32 public constant APPROVAL_EVENT_SIGNATURE = keccak256("InvoiceApproved(bytes32,address,address,uint256)");

    INativeQueryVerifier public immutable VERIFIER;
    address public immutable sourceApprovalContract;

    mapping(bytes32 invoiceId => Invoice invoice) public invoices;
    mapping(bytes32 queryId => bool processed) public processedQueries;

    event InvoiceFunded(
        bytes32 indexed invoiceId,
        address indexed funder,
        address indexed buyer,
        address payee,
        uint256 amount,
        uint64 expiresAt
    );
    event InvoiceReleased(bytes32 indexed invoiceId, bytes32 indexed queryId, address indexed payee, uint256 amount);
    event InvoiceRefunded(bytes32 indexed invoiceId, address indexed funder, uint256 amount);

    constructor(address sourceApprovalContract_) {
        if (sourceApprovalContract_ == address(0)) revert InvalidSourceContract();
        sourceApprovalContract = sourceApprovalContract_;
        VERIFIER = NativeQueryVerifierLib.getVerifier();
    }

    function fundInvoice(bytes32 invoiceId, address buyer, address payable payee, uint64 expiresAt) external payable {
        if (invoiceId == bytes32(0)) revert InvalidInvoice();
        if (buyer == address(0) || payee == address(0) || buyer == payee) revert InvalidParty();
        if (msg.value == 0 || msg.value > type(uint128).max) revert InvalidAmount();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();
        if (invoices[invoiceId].status != InvoiceStatus.None) revert InvoiceAlreadyExists();

        invoices[invoiceId] = Invoice({
            funder: msg.sender,
            buyer: buyer,
            payee: payee,
            amount: uint128(msg.value),
            expiresAt: expiresAt,
            status: InvoiceStatus.Funded
        });

        emit InvoiceFunded(invoiceId, msg.sender, buyer, payee, msg.value, expiresAt);
    }

    function releaseWithProof(
        bytes32 invoiceId,
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external nonReentrant returns (bytes32 queryId) {
        if (chainKey != SEPOLIA_CHAIN_KEY) revert UnsupportedSourceChain();
        if (encodedTransaction.length > MAX_ENCODED_TRANSACTION_BYTES) revert EncodedTransactionTooLarge();
        if (invoices[invoiceId].status != InvoiceStatus.Funded) revert InvoiceNotFunded();

        queryId = _computeQueryId(chainKey, blockHeight, merkleRoot, siblings);
        if (processedQueries[queryId]) revert QueryAlreadyProcessed();

        bool verified = _verifyProof(
            chainKey, blockHeight, encodedTransaction, merkleRoot, siblings, lowerEndpointDigest, continuityRoots
        );
        if (!verified) revert ProofVerificationFailed();

        processedQueries[queryId] = true;
        _releaseApprovedInvoice(invoiceId, queryId, encodedTransaction);
    }

    function refundExpired(bytes32 invoiceId) external nonReentrant {
        Invoice storage invoice = invoices[invoiceId];
        if (invoice.status != InvoiceStatus.Funded) revert InvoiceNotFunded();
        if (msg.sender != invoice.funder) revert OnlyFunder();
        if (block.timestamp <= invoice.expiresAt) revert InvoiceNotExpired();

        invoice.status = InvoiceStatus.Refunded;
        uint256 amount = invoice.amount;
        (bool sent,) = payable(invoice.funder).call{ value: amount }("");
        if (!sent) revert TransferFailed();

        emit InvoiceRefunded(invoiceId, invoice.funder, amount);
    }

    function _computeQueryId(
        uint64 chainKey,
        uint64 blockHeight,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings
    ) internal view returns (bytes32) {
        INativeQueryVerifier.MerkleProof memory merkleProof =
            INativeQueryVerifier.MerkleProof({ root: merkleRoot, siblings: siblings });
        uint64 txIndex = VERIFIER.calculateTxIndex(merkleProof);
        return keccak256(abi.encode(chainKey, blockHeight, txIndex));
    }

    function _verifyProof(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) internal returns (bool) {
        INativeQueryVerifier.MerkleProof memory merkleProof =
            INativeQueryVerifier.MerkleProof({ root: merkleRoot, siblings: siblings });
        INativeQueryVerifier.ContinuityProof memory continuityProof =
            INativeQueryVerifier.ContinuityProof({ lowerEndpointDigest: lowerEndpointDigest, roots: continuityRoots });
        return VERIFIER.verifyAndEmit(chainKey, blockHeight, encodedTransaction, merkleProof, continuityProof);
    }

    function _releaseApprovedInvoice(bytes32 invoiceId, bytes32 queryId, bytes memory encodedTransaction) internal {
        Invoice storage invoice = invoices[invoiceId];
        _requireMatchingApproval(invoiceId, invoice, encodedTransaction);
        invoice.status = InvoiceStatus.Released;

        uint256 amount = invoice.amount;
        address payable payee = invoice.payee;
        (bool sent,) = payee.call{ value: amount }("");
        if (!sent) revert TransferFailed();

        emit InvoiceReleased(invoiceId, queryId, payee, amount);
    }

    function _requireMatchingApproval(bytes32 invoiceId, Invoice storage invoice, bytes memory encodedTransaction)
        internal
        view
    {
        uint8 txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        if (!EvmV1Decoder.isValidTransactionType(txType)) revert UnsupportedTransactionType();

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        if (receipt.receiptStatus != 1) revert SourceTransactionFailed();

        EvmV1Decoder.LogEntry[] memory logs = EvmV1Decoder.getLogsByEventSignature(receipt, APPROVAL_EVENT_SIGNATURE);
        for (uint256 i = 0; i < logs.length; ++i) {
            EvmV1Decoder.LogEntry memory approval = logs[i];
            if (
                approval.address_ != sourceApprovalContract || approval.topics.length != 4 || approval.data.length != 32
            ) {
                continue;
            }

            address buyer = address(uint160(uint256(approval.topics[2])));
            address payee = address(uint160(uint256(approval.topics[3])));
            uint256 amount = abi.decode(approval.data, (uint256));
            if (
                approval.topics[1] == invoiceId && buyer == invoice.buyer && payee == invoice.payee
                    && amount == invoice.amount
            ) {
                return;
            }
        }

        revert MatchingApprovalNotFound();
    }
}
