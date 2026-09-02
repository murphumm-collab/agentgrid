// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @notice Receipt-bound commercial authorization for additional competition
/// executor capacity. This registry does not alter task rewards, verification,
/// or arbitration; a configured TaskRegistry may consume one exact pass once.
contract CompetitionSlotPassRegistry is Ownable, EIP712 {
    uint8 public constant INCLUDED_COMPETITION_SLOTS = 2;
    uint8 public constant MAX_PAID_COMPETITION_SLOTS = 30;
    uint8 public constant MAX_COMPETITION_SLOTS = 32;
    bytes32 public constant ASSET_USDT = keccak256("USDT");
    bytes32 public constant ASSET_USDC = keccak256("USDC");
    bytes32 public constant ASSET_BNB = keccak256("BNB");

    bytes32 private constant AUTHORIZATION_TYPEHASH = keccak256(
        "CompetitionSlotAuthorization(address publisher,address taskRegistry,bytes32 specHash,bytes32 authorizationId,bytes32 paymentReceiptHash,bytes32 asset,uint256 amountAtomic,uint64 issuedAt,uint64 expiresAt,uint8 paidSlots,uint8 totalSlots)"
    );

    struct AuthorizationInput {
        address publisher;
        address taskRegistry;
        bytes32 specHash;
        bytes32 authorizationId;
        bytes32 paymentReceiptHash;
        bytes32 asset;
        uint256 amountAtomic;
        uint64 issuedAt;
        uint64 expiresAt;
        uint8 paidSlots;
        uint8 totalSlots;
    }

    struct Authorization {
        address publisher;
        bytes32 specHash;
        bytes32 paymentReceiptHash;
        bytes32 asset;
        uint256 amountAtomic;
        uint64 issuedAt;
        uint64 expiresAt;
        uint8 paidSlots;
        uint8 totalSlots;
        bool consumed;
    }

    address public immutable taskRegistry;
    address public issuer;
    mapping(bytes32 => Authorization) private authorizations;
    mapping(bytes32 => bytes32) public receiptAuthorizationId;

    error Unauthorized();
    error InvalidAuthorization();
    error AuthorizationAlreadyRegistered();
    error PaymentReceiptAlreadyRegistered();
    error AuthorizationExpired();
    error AuthorizationMismatch();

    event CompetitionSlotIssuerUpdated(address indexed previousIssuer, address indexed newIssuer);
    event CompetitionSlotAuthorizationRegistered(
        bytes32 indexed authorizationId,
        address indexed publisher,
        bytes32 indexed paymentReceiptHash,
        address taskRegistry,
        bytes32 specHash,
        bytes32 asset,
        uint256 amountAtomic,
        uint64 issuedAt,
        uint64 expiresAt,
        uint8 includedSlots,
        uint8 paidSlots,
        uint8 totalSlots,
        address issuer
    );
    event CompetitionSlotAuthorizationConsumed(
        bytes32 indexed authorizationId,
        address indexed publisher,
        bytes32 indexed paymentReceiptHash,
        address taskRegistry,
        bytes32 specHash,
        bytes32 asset,
        uint256 amountAtomic,
        uint64 issuedAt,
        uint64 expiresAt,
        uint8 includedSlots,
        uint8 paidSlots,
        uint8 totalSlots
    );

    constructor(address taskRegistry_, address issuer_, address initialOwner)
        Ownable(initialOwner)
        EIP712("AgentGrid Competition Slot Pass", "1")
    {
        if (taskRegistry_ == address(0) || issuer_ == address(0) || initialOwner == address(0)) revert Unauthorized();
        taskRegistry = taskRegistry_;
        issuer = issuer_;
        emit CompetitionSlotIssuerUpdated(address(0), issuer_);
    }

    function setIssuer(address newIssuer) external onlyOwner {
        if (newIssuer == address(0) || newIssuer == issuer) revert Unauthorized();
        address previous = issuer;
        issuer = newIssuer;
        emit CompetitionSlotIssuerUpdated(previous, newIssuer);
    }

    function registerAuthorization(AuthorizationInput calldata input, bytes calldata signature) external {
        _validateInput(input);
        if (authorizations[input.authorizationId].publisher != address(0)) revert AuthorizationAlreadyRegistered();
        if (receiptAuthorizationId[input.paymentReceiptHash] != bytes32(0)) revert PaymentReceiptAlreadyRegistered();
        if (ECDSA.recover(_hashTypedDataV4(_authorizationStructHash(input)), signature) != issuer) revert Unauthorized();

        authorizations[input.authorizationId] = Authorization({
            publisher: input.publisher,
            specHash: input.specHash,
            paymentReceiptHash: input.paymentReceiptHash,
            asset: input.asset,
            amountAtomic: input.amountAtomic,
            issuedAt: input.issuedAt,
            expiresAt: input.expiresAt,
            paidSlots: input.paidSlots,
            totalSlots: input.totalSlots,
            consumed: false
        });
        receiptAuthorizationId[input.paymentReceiptHash] = input.authorizationId;
        emit CompetitionSlotAuthorizationRegistered(
            input.authorizationId, input.publisher, input.paymentReceiptHash, input.taskRegistry,
            input.specHash, input.asset, input.amountAtomic, input.issuedAt, input.expiresAt,
            INCLUDED_COMPETITION_SLOTS, input.paidSlots, input.totalSlots, issuer
        );
    }

    function consume(
        bytes32 authorizationId,
        address publisher,
        bytes32 specHash,
        bytes32 paymentReceiptHash,
        bytes32 asset,
        uint256 amountAtomic,
        uint8 paidSlots,
        uint8 totalSlots
    ) external {
        if (msg.sender != taskRegistry) revert Unauthorized();
        Authorization storage authorization = authorizations[authorizationId];
        if (authorization.publisher == address(0) || authorization.consumed) revert InvalidAuthorization();
        if (block.timestamp >= authorization.expiresAt) revert AuthorizationExpired();
        if (
            authorization.publisher != publisher || authorization.specHash != specHash ||
            authorization.paymentReceiptHash != paymentReceiptHash || authorization.asset != asset ||
            authorization.amountAtomic != amountAtomic || authorization.paidSlots != paidSlots ||
            authorization.totalSlots != totalSlots
        ) revert AuthorizationMismatch();
        authorization.consumed = true;
        emit CompetitionSlotAuthorizationConsumed(
            authorizationId, publisher, paymentReceiptHash, msg.sender, specHash, asset,
            amountAtomic, authorization.issuedAt, authorization.expiresAt,
            INCLUDED_COMPETITION_SLOTS, paidSlots, totalSlots
        );
    }

    function getAuthorization(bytes32 authorizationId) external view returns (Authorization memory) {
        return authorizations[authorizationId];
    }

    function authorizationDigest(AuthorizationInput calldata input) external view returns (bytes32) {
        return _hashTypedDataV4(_authorizationStructHash(input));
    }

    function _validateInput(AuthorizationInput calldata input) private view {
        if (
            input.publisher == address(0) || input.taskRegistry != taskRegistry || input.specHash == bytes32(0) ||
            input.authorizationId == bytes32(0) || input.paymentReceiptHash == bytes32(0) || !_supportedAsset(input.asset) ||
            input.amountAtomic == 0 || input.issuedAt == 0 || input.issuedAt > block.timestamp || input.expiresAt <= block.timestamp ||
            input.expiresAt <= input.issuedAt || input.paidSlots == 0 || input.paidSlots > MAX_PAID_COMPETITION_SLOTS ||
            input.totalSlots != INCLUDED_COMPETITION_SLOTS + input.paidSlots || input.totalSlots > MAX_COMPETITION_SLOTS
        ) revert InvalidAuthorization();
    }

    function _supportedAsset(bytes32 asset) private pure returns (bool) {
        return asset == ASSET_USDT || asset == ASSET_USDC || asset == ASSET_BNB;
    }

    function _authorizationStructHash(AuthorizationInput calldata input) private pure returns (bytes32) {
        return keccak256(abi.encode(
            AUTHORIZATION_TYPEHASH,
            input.publisher,
            input.taskRegistry,
            input.specHash,
            input.authorizationId,
            input.paymentReceiptHash,
            input.asset,
            input.amountAtomic,
            input.issuedAt,
            input.expiresAt,
            input.paidSlots,
            input.totalSlots
        ));
    }
}
