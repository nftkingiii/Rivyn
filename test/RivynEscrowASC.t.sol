// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { RivynEscrowASC } from "../contracts/RivynEscrowASC.sol";
import { INativeQueryVerifier } from "../contracts/VerifierInterface.sol";
import { EvmV1Decoder } from "@gluwa/usc-contracts/contracts/decoding/EvmV1Decoder.sol";

interface Vm {
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function etch(address target, bytes calldata code) external;
}

contract MockVerifier is INativeQueryVerifier {
    function verifyAndEmit(uint64, uint64, bytes calldata, MerkleProof calldata, ContinuityProof calldata)
        external
        pure
        returns (bool)
    {
        return true;
    }

    function calculateTxIndex(MerkleProof calldata) external pure returns (uint64) {
        return 7;
    }
}

contract RivynEscrowASCTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    RivynEscrowASC internal escrow;

    address internal constant FUNDER = address(0xF00D);
    address internal constant BUYER = address(0xB0B);
    address payable internal constant PAYEE = payable(address(0xCAFE));
    bytes32 internal constant INVOICE_ID = keccak256("invoice-1");
    address internal constant SOURCE_CONTRACT = address(0x1234);
    address internal constant PRECOMPILE = 0x0000000000000000000000000000000000000FD2;

    function setUp() public {
        escrow = new RivynEscrowASC(SOURCE_CONTRACT);
        MockVerifier mock = new MockVerifier();
        vm.etch(PRECOMPILE, address(mock).code);
        vm.deal(FUNDER, 10 ether);
    }

    function testFundsAndRefundsOnlyAfterExpiry() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        vm.prank(FUNDER);
        escrow.fundInvoice{ value: 2 ether }(INVOICE_ID, BUYER, PAYEE, expiry);

        (address funder, address buyer, address payee, uint128 amount,, RivynEscrowASC.InvoiceStatus status) =
            escrow.invoices(INVOICE_ID);
        require(funder == FUNDER && buyer == BUYER && payee == PAYEE, "invoice parties mismatch");
        require(amount == 2 ether && status == RivynEscrowASC.InvoiceStatus.Funded, "invoice not funded");

        vm.prank(FUNDER);
        (bool early,) = address(escrow).call(abi.encodeCall(RivynEscrowASC.refundExpired, (INVOICE_ID)));
        require(!early, "early refund accepted");

        vm.warp(expiry + 1);
        uint256 before = FUNDER.balance;
        vm.prank(FUNDER);
        escrow.refundExpired(INVOICE_ID);
        require(FUNDER.balance == before + 2 ether, "refund missing");
        (,,,,, status) = escrow.invoices(INVOICE_ID);
        require(status == RivynEscrowASC.InvoiceStatus.Refunded, "wrong terminal state");
    }

    function testRejectsUnsupportedSourceBeforeCallingVerifier() public {
        vm.prank(FUNDER);
        escrow.fundInvoice{ value: 1 ether }(INVOICE_ID, BUYER, PAYEE, uint64(block.timestamp + 1 days));

        INativeQueryVerifier.MerkleProofEntry[] memory siblings = new INativeQueryVerifier.MerkleProofEntry[](0);
        bytes32[] memory roots = new bytes32[](0);
        (bool success,) = address(escrow)
            .call(
                abi.encodeCall(
                    RivynEscrowASC.releaseWithProof,
                    (INVOICE_ID, 99, 1, hex"01", bytes32(0), siblings, bytes32(0), roots)
                )
            );
        require(!success, "unsupported chain accepted");
    }

    function testOnlyFunderCanRefund() public {
        vm.prank(FUNDER);
        escrow.fundInvoice{ value: 1 ether }(INVOICE_ID, BUYER, PAYEE, uint64(block.timestamp + 1));
        vm.warp(block.timestamp + 2);
        vm.prank(BUYER);
        (bool success,) = address(escrow).call(abi.encodeCall(RivynEscrowASC.refundExpired, (INVOICE_ID)));
        require(!success, "non-funder refund accepted");
    }

    function testMatchingAttestcoinPayloadReleasesEscrow() public {
        _fund(INVOICE_ID, 2 ether);
        bytes memory encodedTransaction = _encodedApproval(1, SOURCE_CONTRACT, INVOICE_ID, BUYER, PAYEE, 2 ether);
        uint256 before = PAYEE.balance;

        bytes32 queryId = _release(INVOICE_ID, encodedTransaction, bytes32(uint256(1)));
        require(PAYEE.balance == before + 2 ether, "payee not paid");
        require(escrow.processedQueries(queryId), "query not consumed");
        (,,,,, RivynEscrowASC.InvoiceStatus status) = escrow.invoices(INVOICE_ID);
        require(status == RivynEscrowASC.InvoiceStatus.Released, "invoice not released");
    }

    function testRejectsFailedReceiptWrongSourceAndWrongAmount() public {
        _fund(INVOICE_ID, 2 ether);
        bytes[] memory invalid = new bytes[](3);
        invalid[0] = _encodedApproval(0, SOURCE_CONTRACT, INVOICE_ID, BUYER, PAYEE, 2 ether);
        invalid[1] = _encodedApproval(1, address(0x9999), INVOICE_ID, BUYER, PAYEE, 2 ether);
        invalid[2] = _encodedApproval(1, SOURCE_CONTRACT, INVOICE_ID, BUYER, PAYEE, 3 ether);

        for (uint256 i; i < invalid.length; ++i) {
            (bool success,) =
                address(this).call(abi.encodeCall(this.releaseExternal, (INVOICE_ID, invalid[i], bytes32(i + 1))));
            require(!success, "invalid approval released escrow");
        }
        (,,,,, RivynEscrowASC.InvoiceStatus status) = escrow.invoices(INVOICE_ID);
        require(status == RivynEscrowASC.InvoiceStatus.Funded, "failed proof changed state");
    }

    function testOneTransactionProofCannotReleaseTwoInvoices() public {
        bytes32 secondId = keccak256("invoice-2");
        _fund(INVOICE_ID, 1 ether);
        _fund(secondId, 1 ether);
        bytes memory payload = _encodedApprovals(INVOICE_ID, secondId, 1 ether);
        bytes32 root = bytes32(uint256(77));

        _release(INVOICE_ID, payload, root);
        (bool success,) = address(this).call(abi.encodeCall(this.releaseExternal, (secondId, payload, root)));
        require(!success, "replayed transaction proof accepted");
        (,,,,, RivynEscrowASC.InvoiceStatus status) = escrow.invoices(secondId);
        require(status == RivynEscrowASC.InvoiceStatus.Funded, "replay changed second invoice");
    }

    function releaseExternal(bytes32 invoiceId, bytes memory payload, bytes32 root) external returns (bytes32) {
        return _release(invoiceId, payload, root);
    }

    function _fund(bytes32 invoiceId, uint256 amount) internal {
        vm.prank(FUNDER);
        escrow.fundInvoice{ value: amount }(invoiceId, BUYER, PAYEE, uint64(block.timestamp + 1 days));
    }

    function _release(bytes32 invoiceId, bytes memory payload, bytes32 root) internal returns (bytes32) {
        INativeQueryVerifier.MerkleProofEntry[] memory siblings = new INativeQueryVerifier.MerkleProofEntry[](0);
        bytes32[] memory roots = new bytes32[](0);
        return escrow.releaseWithProof(invoiceId, 1, 100, payload, root, siblings, bytes32(0), roots);
    }

    function _encodedApproval(
        uint8 receiptStatus,
        address source,
        bytes32 invoiceId,
        address buyer,
        address payee,
        uint256 amount
    ) internal pure returns (bytes memory) {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = _approvalLog(source, invoiceId, buyer, payee, amount);
        return _encodedReceipt(receiptStatus, logs);
    }

    function _encodedApprovals(bytes32 firstId, bytes32 secondId, uint256 amount) internal pure returns (bytes memory) {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](2);
        logs[0] = _approvalLog(SOURCE_CONTRACT, firstId, BUYER, PAYEE, amount);
        logs[1] = _approvalLog(SOURCE_CONTRACT, secondId, BUYER, PAYEE, amount);
        return _encodedReceipt(1, logs);
    }

    function _approvalLog(address source, bytes32 invoiceId, address buyer, address payee, uint256 amount)
        internal
        pure
        returns (EvmV1Decoder.LogEntryTuple memory)
    {
        bytes32[] memory topics = new bytes32[](4);
        topics[0] = keccak256("InvoiceApproved(bytes32,address,address,uint256)");
        topics[1] = invoiceId;
        topics[2] = bytes32(uint256(uint160(buyer)));
        topics[3] = bytes32(uint256(uint160(payee)));
        return EvmV1Decoder.LogEntryTuple({ address_: source, topics: topics, data: abi.encode(amount) });
    }

    function _encodedReceipt(uint8 receiptStatus, EvmV1Decoder.LogEntryTuple[] memory logs)
        internal
        pure
        returns (bytes memory)
    {
        bytes[] memory chunks = new bytes[](3);
        chunks[0] = bytes("");
        chunks[1] = bytes("");
        chunks[2] = abi.encode(receiptStatus, uint64(21_000), logs, bytes(""));
        return abi.encode(uint8(2), chunks);
    }
}
