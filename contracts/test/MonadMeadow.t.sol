// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MonadMeadow} from "../src/MonadMeadow.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MonadMeadowTest is Test {
    MonadMeadow meadow;

    address owner = address(this);
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        meadow = new MonadMeadow();
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    // --- Minting ---------------------------------------------------------

    function test_MintChargesCorrectPriceAndAssignsKind() public {
        vm.prank(alice);
        uint256 id = meadow.mintItem{value: 0.01 ether}(0);
        assertEq(id, 1);
        assertEq(meadow.ownerOf(1), alice);
        assertEq(meadow.kindOf(1), 0);
        assertEq(meadow.treasury(), 0.01 ether);
    }

    function test_MintRevertsWhenUnderpaying() public {
        vm.prank(alice);
        vm.expectRevert(MonadMeadow.WrongPrice.selector);
        meadow.mintItem{value: 0.009 ether}(0);
    }

    function test_MintRevertsOnBadKind() public {
        vm.prank(alice);
        vm.expectRevert(MonadMeadow.BadKind.selector);
        meadow.mintItem{value: 1 ether}(5);
    }

    function test_TokenIdsIncrement() public {
        vm.startPrank(alice);
        uint256 a = meadow.mintItem{value: 0.02 ether}(1);
        uint256 b = meadow.mintItem{value: 0.03 ether}(2);
        vm.stopPrank();
        assertEq(a, 1);
        assertEq(b, 2);
    }

    // --- Marketplace: happy path ----------------------------------------

    function test_ListEscrowsAndBuyPaysSellerMinusFee() public {
        vm.prank(alice);
        meadow.mintItem{value: 0.01 ether}(0);

        vm.prank(alice);
        meadow.list(1, 1 ether);
        // token is escrowed in the contract
        assertEq(meadow.ownerOf(1), address(meadow));

        uint256 sellerBefore = alice.balance;
        vm.prank(bob);
        meadow.buy{value: 1 ether}(1);

        assertEq(meadow.ownerOf(1), bob);
        uint256 fee = (uint256(1 ether) * meadow.feeBps()) / 10_000; // 2.5%
        assertEq(alice.balance, sellerBefore + (1 ether - fee));
        // treasury holds the mint fee + the sale fee
        assertEq(meadow.treasury(), 0.01 ether + fee);
    }

    // --- Marketplace: refund / cancel (reclaim escrow) ------------------

    function test_CancelListingReturnsToken() public {
        vm.startPrank(alice);
        meadow.mintItem{value: 0.01 ether}(0);
        meadow.list(1, 1 ether);
        assertEq(meadow.ownerOf(1), address(meadow));
        meadow.cancelListing(1);
        vm.stopPrank();
        assertEq(meadow.ownerOf(1), alice);
        (address seller,) = meadow.listings(1);
        assertEq(seller, address(0));
    }

    // --- Marketplace: guards --------------------------------------------

    function test_CannotListSomeoneElsesToken() public {
        vm.prank(alice);
        meadow.mintItem{value: 0.01 ether}(0);
        vm.prank(bob);
        vm.expectRevert(MonadMeadow.NotOwner.selector);
        meadow.list(1, 1 ether);
    }

    function test_CannotBuyWithWrongValue() public {
        vm.startPrank(alice);
        meadow.mintItem{value: 0.01 ether}(0);
        meadow.list(1, 1 ether);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(MonadMeadow.WrongPrice.selector);
        meadow.buy{value: 0.5 ether}(1);
    }

    function test_SellerCannotBuyOwnListing() public {
        vm.startPrank(alice);
        meadow.mintItem{value: 0.01 ether}(0);
        meadow.list(1, 1 ether);
        vm.expectRevert(MonadMeadow.SelfBuy.selector);
        meadow.buy{value: 1 ether}(1);
        vm.stopPrank();
    }

    function test_CannotBuyUnlistedToken() public {
        vm.prank(alice);
        meadow.mintItem{value: 0.01 ether}(0);
        vm.prank(bob);
        vm.expectRevert(MonadMeadow.NotListed.selector);
        meadow.buy{value: 1 ether}(1);
    }

    function test_CannotDoubleList() public {
        vm.startPrank(alice);
        meadow.mintItem{value: 0.01 ether}(0);
        meadow.list(1, 1 ether);
        vm.expectRevert(); // token now owned by contract -> NotOwner on second list
        meadow.list(1, 2 ether);
        vm.stopPrank();
    }

    // --- Admin / permissions --------------------------------------------

    function test_OnlyOwnerCanSetMintPrice() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        meadow.setMintPrice(0, 1 ether);
    }

    function test_OwnerCanWithdrawTreasury() public {
        vm.prank(alice);
        meadow.mintItem{value: 0.05 ether}(4);
        uint256 before = bob.balance;
        meadow.withdrawTreasury(bob);
        assertEq(bob.balance, before + 0.05 ether);
        assertEq(meadow.treasury(), 0);
    }

    function test_OnlyOwnerCanWithdraw() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        meadow.withdrawTreasury(alice);
    }

    function test_FeeCappedAtMax() public {
        vm.expectRevert(MonadMeadow.FeeTooHigh.selector);
        meadow.setFeeBps(1001);
    }

    // --- Metadata --------------------------------------------------------

    function test_TokenURIReturnsOnchainData() public {
        vm.prank(alice);
        meadow.mintItem{value: 0.02 ether}(1);
        string memory uri = meadow.tokenURI(1);
        // starts with the base64 json data URI prefix
        assertEq(_startsWith(uri, "data:application/json;base64,"), true);
    }

    function _startsWith(string memory s, string memory prefix) internal pure returns (bool) {
        bytes memory b = bytes(s);
        bytes memory p = bytes(prefix);
        if (b.length < p.length) return false;
        for (uint256 i = 0; i < p.length; i++) {
            if (b[i] != p[i]) return false;
        }
        return true;
    }
}
