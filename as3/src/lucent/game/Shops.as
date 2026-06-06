package lucent.game {
  import lucent.Main;
  import lucent.util.Util;

  [BridgeNamespace("shops")]
  public class Shops {
    private static var game:Object = Main.getInstance().getGame();
    private static const SHOP_POPUP_LABELS:Object = {
      "Shop": true,
      "MergeShop": true,
      "HouseShop": true
    };

    private static function getShopInfo():Object {
      return game.world.shopinfo;
    }

    private static function getShopItems():Array {
      var info:Object = getShopInfo();
      if (!info || !(info.items is Array)) {
        return [];
      }

      return info.items;
    }

    private static function getItemByShopItemId(shopItemId:String):Object {
      if (!shopItemId) {
        return null;
      }

      for each (var item:Object in getShopItems()) {
        if (item && "ShopItemID" in item && String(item.ShopItemID) == shopItemId) {
          return item;
        }
      }

      return null;
    }

    private static function getInventoryItem(key:*):Object {
      var item:Object = Inventory.getItem(key);
      if (item || !(key is String)) {
        return item;
      }

      var itemId:Number = Number(key);
      if (isNaN(itemId)) {
        return null;
      }

      return Inventory.getItem(int(itemId));
    }

    private static function sendBuy(item:Object, quantity:int):void {
      if (!game.world.coolDown("buyItem")) {
        return;
      }

      game.world.shopBuyItem = item;
      if (quantity === 1) {
        game.sfc.sendXtMessage("zm", "buyItem", [
          item.ItemID,
          game.world.shopinfo.ShopID,
          item.ShopItemID
        ], "str", game.world.curRoom);
        return;
      }

      game.sfc.sendXtMessage("zm", "buyItem", [
        item.ItemID,
        game.world.shopinfo.ShopID,
        item.ShopItemID,
        quantity
      ], "str", game.world.curRoom);
    }

    private static function sendSell(item:Object, quantity:int):void {
      if (quantity === -1) {
        game.world.sendSellItemRequest(item);
        return;
      }

      game.world.sendSellItemRequestWithQuantity({
        accept: 1,
        iSel: item,
        iQty: quantity
      });
    }

    [BridgeExport]
    public static function getItem(key:*):Object {
      if (!key) {
        return null;
      }

      var items:Array = getShopItems();
      if (items.length === 0) {
        return null;
      }

      var item:Object = ItemLookup.find(items, key);
      if (item || !(key is String)) {
        return item;
      }

      var itemId:Number = Number(key);
      if (isNaN(itemId)) {
        return null;
      }

      return ItemLookup.find(items, int(itemId));
    }

    [BridgeExport]
    public static function getMaxBuyQuantity(key:*):int {
      if (!getShopInfo()) {
        return 0;
      }

      var item:Object = getItem(key);
      if (!item) {
        return 0;
      }

      return game.world.maximumShopBuys(item);
    }

    [BridgeExport]
    public static function getMaxBuyQuantityByShopItemId(shopItemId:String):int {
      if (!getShopInfo()) {
        return 0;
      }

      var item:Object = getItemByShopItemId(shopItemId);
      if (!item) {
        return 0;
      }

      return game.world.maximumShopBuys(item);
    }

    private static function isShopPopupOpen():Boolean {
      var popup:* = game.ui.mcPopup;

      return popup != null &&
        popup.visible &&
        SHOP_POPUP_LABELS[popup.currentLabel] === true;
    }

    [BridgeExport]
    public static function isOpen(shopId:int = 0):Boolean {
      var info:Object = getShopInfo();

      if (!isShopPopupOpen() || info == null || !("ShopID" in info)) {
        return false;
      }

      return shopId <= 0 || int(info.ShopID) == shopId;
    }

    [BridgeExport]
    public static function close(shopId:int = 0):Boolean {
      if (!isOpen(shopId)) {
        return false;
      }

      game.ui.mcPopup.onClose();
      return true;
    }

    private static function canBuyQuantity(item:Object, quantity:int):Boolean {
      if (!item || quantity <= 0) {
        return false;
      }

      if (!Util.canBuyItem(item)) {
        return false;
      }

      return game.world.maximumShopBuys(item) >= quantity;
    }

    [BridgeExport]
    public static function buyByName(name:String, quantity:int = 1):void {
      if (!name || quantity <= 0) {
        return;
      }

      var item:Object = getItem(name);
      if (!canBuyQuantity(item, quantity)) {
        return;
      }

      sendBuy(item, quantity);
    }

    [BridgeExport]
    public static function buyById(id:int, quantity:int = 1):void {
      if (id <= 0 || quantity <= 0) {
        return;
      }

      var item:Object = getItem(id);
      if (!canBuyQuantity(item, quantity)) {
        return;
      }

      sendBuy(item, quantity);
    }

    [BridgeExport]
    public static function buyByShopItemId(shopItemId:String, quantity:int = 1):void {
      if (!shopItemId || quantity <= 0) {
        return;
      }

      var item:Object = getItemByShopItemId(shopItemId);
      if (!canBuyQuantity(item, quantity)) {
        return;
      }

      sendBuy(item, quantity);
    }

    [BridgeExport]
    public static function sellByName(name:String, quantity:int = -1):Boolean {
      if (!name || (quantity !== -1 && quantity <= 0)) {
        return false;
      }

      var item:Object = Inventory.getItem(name);
      if (!item) {
        return false;
      }

      sendSell(item, quantity);
      return true;
    }

    [BridgeExport]
    public static function sellById(id:int, quantity:int = -1):Boolean {
      if (id <= 0 || (quantity !== -1 && quantity <= 0)) {
        return false;
      }

      var item:Object = getInventoryItem(id);
      if (!item) {
        return false;
      }

      sendSell(item, quantity);
      return true;
    }

    [BridgeExport]
    public static function load(shopId:int):void {
      game.world.sendLoadShopRequest(shopId);
    }

    [BridgeExport]
    public static function loadHairShop(shopId:int):void {
      game.world.sendLoadHairShopRequest(shopId);
    }

    [BridgeExport]
    public static function loadArmorCustomize():void {
      game.openArmorCustomize();
    }

    [BridgeExport]
    public static function isMergeShop():Boolean {
      var info:Object = getShopInfo();
      if (!info) {
        return false;
      }

      return game.isMergeShop(info);
    }

    [BridgeExport]
    public static function canBuyItem(key:*, quantity:int = 1):Boolean {
      if (!getShopInfo()) {
        return false;
      }

      var item:Object = getItem(key);
      if (!item) {
        return false;
      }

      return canBuyQuantity(item, quantity);
    }

    [BridgeExport]
    public static function canBuyByShopItemId(shopItemId:String, quantity:int = 1):Boolean {
      if (!getShopInfo()) {
        return false;
      }

      var item:Object = getItemByShopItemId(shopItemId);
      if (!item) {
        return false;
      }

      return canBuyQuantity(item, quantity);
    }
  }
}
