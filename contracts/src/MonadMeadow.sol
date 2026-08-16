// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title MonadMeadow
/// @notice A calm 2D world's item economy. Players mint the crystals they gather
///         (a MON micro-transaction) and trade them peer-to-peer for MON.
/// @dev    Metadata + art are fully on-chain. Marketplace uses escrow so a listed
///         item can never be double-spent or transferred out from under a buyer.
contract MonadMeadow is ERC721, Ownable, ReentrancyGuard {
    using Strings for uint256;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @dev The five gatherable crystal kinds. Kept as a plain uint8 on-chain.
    uint8 public constant ITEM_KINDS = 5;

    struct Listing {
        address seller;
        uint96 price; // MON in wei; uint96 caps at ~7.9e28, ample for testnet
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    uint256 public nextTokenId = 1;

    /// @notice kind index (0..4) for each token.
    mapping(uint256 tokenId => uint8 kind) public kindOf;

    /// @notice mint price per kind, in wei.
    mapping(uint8 kind => uint256 price) public mintPrice;

    /// @notice active marketplace listing for a token (seller == address(0) if none).
    mapping(uint256 tokenId => Listing) public listings;

    /// @notice marketplace fee in basis points routed to the treasury on each sale.
    uint16 public feeBps = 250; // 2.5%
    uint16 public constant MAX_FEE_BPS = 1000; // 10% hard cap

    /// @notice accrued protocol funds (mint fees + sale fees) withdrawable by owner.
    uint256 public treasury;

    /// @notice reward in MON (wei) for each crystal kind when gathered.
    mapping(uint8 kind => uint256 reward) public rewardAmount;

    /// @notice track claimed rewards to prevent double-claiming: player => (kind => timestamp of last claim)
    mapping(address player => mapping(uint8 kind => uint256 lastClaimTime)) public lastRewardClaim;

    /// @notice cooldown between claims of the same kind (in seconds).
    uint256 public claimCooldown = 10;

    string[ITEM_KINDS] private _names = ["Dewdrop", "Sunbloom", "Moonpetal", "Emberseed", "Tidecrystal"];
    string[ITEM_KINDS] private _colors = ["#8fd3c7", "#ffd98e", "#c9b6ff", "#ff9d8a", "#8ec5ff"];

    // ---------------------------------------------------------------------
    // Events (indexer-friendly)
    // ---------------------------------------------------------------------

    event ItemMinted(uint256 indexed tokenId, address indexed owner, uint8 indexed kind, uint256 pricePaid);
    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event Unlisted(uint256 indexed tokenId, address indexed seller);
    event Sale(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price, uint256 fee);
    event MintPriceSet(uint8 indexed kind, uint256 price);
    event FeeSet(uint16 feeBps);
    event TreasuryWithdrawn(address indexed to, uint256 amount);
    event RewardClaimed(address indexed player, uint8 indexed kind, uint256 amount);
    event RewardAmountSet(uint8 indexed kind, uint256 amount);
    event ClaimCooldownSet(uint256 cooldown);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error BadKind();
    error WrongPrice();
    error NotOwner();
    error NotListed();
    error AlreadyListed();
    error ZeroPrice();
    error FeeTooHigh();
    error TransferFailed();
    error SelfBuy();
    error RewardOnCooldown();
    error InsufficientRewardFunds();
    error ZeroRewardAmount();

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    constructor() ERC721("Monad Meadow Crystal", "MEADOW") Ownable(msg.sender) {
        // Gentle default prices in MON so a demo is cheap: 0.01 -> 0.05 MON.
        mintPrice[0] = 0.01 ether;
        mintPrice[1] = 0.02 ether;
        mintPrice[2] = 0.03 ether;
        mintPrice[3] = 0.04 ether;
        mintPrice[4] = 0.05 ether;

        // Default rewards: 0.005 -> 0.025 MON for gathering each crystal.
        rewardAmount[0] = 0.005 ether;
        rewardAmount[1] = 0.01 ether;
        rewardAmount[2] = 0.015 ether;
        rewardAmount[3] = 0.02 ether;
        rewardAmount[4] = 0.025 ether;
    }

    // ---------------------------------------------------------------------
    // Minting (the micro-transaction)
    // ---------------------------------------------------------------------

    /// @notice Mint the crystal you gathered in the meadow. Overpayment is credited
    ///         to the treasury (kept simple + gas-tight — no refund branch).
    function mintItem(uint8 kind) external payable returns (uint256 tokenId) {
        if (kind >= ITEM_KINDS) revert BadKind();
        if (msg.value < mintPrice[kind]) revert WrongPrice();

        tokenId = nextTokenId++;
        kindOf[tokenId] = kind;
        treasury += msg.value;

        _safeMint(msg.sender, tokenId);
        emit ItemMinted(tokenId, msg.sender, kind, msg.value);
    }

    // ---------------------------------------------------------------------
    // Rewards (direct MON transfer when gathering crystals)
    // ---------------------------------------------------------------------

    /// @notice Claim a reward in MON for gathering a crystal of this kind.
    ///         Includes cooldown to prevent double-claiming the same kind rapidly.
    function claimReward(uint8 kind) external nonReentrant {
        if (kind >= ITEM_KINDS) revert BadKind();
        uint256 reward = rewardAmount[kind];
        if (reward == 0) revert ZeroRewardAmount();
        
        // Check cooldown
        if (block.timestamp < lastRewardClaim[msg.sender][kind] + claimCooldown) {
            revert RewardOnCooldown();
        }

        // Verify contract has funds
        if (address(this).balance < reward) revert InsufficientRewardFunds();

        // Record the claim
        lastRewardClaim[msg.sender][kind] = block.timestamp;

        // Send the reward
        (bool ok,) = payable(msg.sender).call{value: reward}("");
        if (!ok) revert TransferFailed();

        emit RewardClaimed(msg.sender, kind, reward);
    }

    /// @notice Claim dragon bounty: 10 MON for defeating the dungeon dragon.
    function claimDragonBounty() external nonReentrant {
        require(address(this).balance >= 10 ether, "InsufficientRewardFunds");
        
        uint256 bounty = 10 ether;
        (bool ok,) = payable(msg.sender).call{value: bounty}("");
        if (!ok) revert TransferFailed();
        
        emit RewardClaimed(msg.sender, 99, bounty); // Kind 99 = dragon bounty
    }

    /// @notice Deduct death penalty: loses 5 MON for dying to the dragon.
    ///         Player must send 5 MON to contract.
    function payDeathPenalty() external payable nonReentrant {
        if (msg.value != 5 ether) revert WrongPrice();
        treasury += msg.value;
        // No refund - penalty stays in treasury
    }

    // ---------------------------------------------------------------------
    // Marketplace (trade items for MON)
    // ---------------------------------------------------------------------

    /// @notice List an owned token for sale. The token is escrowed in the contract.
    function list(uint256 tokenId, uint96 price) external {
        if (price == 0) revert ZeroPrice();
        if (ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (listings[tokenId].seller != address(0)) revert AlreadyListed();

        listings[tokenId] = Listing({seller: msg.sender, price: price});
        _transfer(msg.sender, address(this), tokenId); // escrow
        emit Listed(tokenId, msg.sender, price);
    }

    /// @notice Cancel your own listing and reclaim the escrowed token.
    function cancelListing(uint256 tokenId) external {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (l.seller != msg.sender) revert NotOwner();

        delete listings[tokenId];
        _transfer(address(this), msg.sender, tokenId);
        emit Unlisted(tokenId, msg.sender);
    }

    /// @notice Buy a listed token for MON. Pays the seller, routes the fee to treasury.
    function buy(uint256 tokenId) external payable nonReentrant {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (l.seller == msg.sender) revert SelfBuy();
        if (msg.value != l.price) revert WrongPrice();

        delete listings[tokenId];

        uint256 fee = (uint256(l.price) * feeBps) / 10_000;
        uint256 proceeds = l.price - fee;
        treasury += fee;

        _transfer(address(this), msg.sender, tokenId);

        (bool ok,) = payable(l.seller).call{value: proceeds}("");
        if (!ok) revert TransferFailed();

        emit Sale(tokenId, l.seller, msg.sender, l.price, fee);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setMintPrice(uint8 kind, uint256 price) external onlyOwner {
        if (kind >= ITEM_KINDS) revert BadKind();
        mintPrice[kind] = price;
        emit MintPriceSet(kind, price);
    }

    function setFeeBps(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = newFeeBps;
        emit FeeSet(newFeeBps);
    }

    function setRewardAmount(uint8 kind, uint256 amount) external onlyOwner {
        if (kind >= ITEM_KINDS) revert BadKind();
        rewardAmount[kind] = amount;
        emit RewardAmountSet(kind, amount);
    }

    function setClaimCooldown(uint256 cooldown) external onlyOwner {
        claimCooldown = cooldown;
        emit ClaimCooldownSet(cooldown);
    }

    function withdrawTreasury(address to) external onlyOwner nonReentrant {
        uint256 amount = treasury;
        treasury = 0;
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit TreasuryWithdrawn(to, amount);
    }

    /// @notice Deposit MON into the contract to fund future rewards.
    receive() external payable {}

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function kindName(uint8 kind) public view returns (string memory) {
        if (kind >= ITEM_KINDS) revert BadKind();
        return _names[kind];
    }

    /// @notice Fully on-chain metadata + SVG art so crystals render in any wallet.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        uint8 kind = kindOf[tokenId];
        string memory name = _names[kind];
        string memory color = _colors[kind];

        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">',
            '<defs><radialGradient id="g" cx="50%" cy="40%" r="70%">',
            '<stop offset="0%" stop-color="#fbfcff"/><stop offset="100%" stop-color="',
            color,
            '"/></radialGradient></defs>',
            '<rect width="400" height="400" fill="#f3f6fb"/>',
            '<circle cx="200" cy="210" r="120" fill="url(#g)" opacity="0.55"/>',
            '<polygon points="200,90 280,210 200,330 120,210" fill="',
            color,
            '" stroke="#ffffff" stroke-width="6"/>',
            '<polygon points="200,90 200,330 120,210" fill="#000000" opacity="0.06"/>',
            '<text x="200" y="372" font-family="Georgia,serif" font-size="26" fill="#5b6472" text-anchor="middle">',
            name,
            "</text></svg>"
        );

        string memory json = string.concat(
            '{"name":"',
            name,
            " #",
            tokenId.toString(),
            '","description":"A crystal gathered in Monad Meadow, a calm shared world.",',
            '"attributes":[{"trait_type":"Kind","value":"',
            name,
            '"}],"image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)),
            '"}'
        );

        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
