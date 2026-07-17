package lucent.game
{
  import lucent.Main;
  import flash.events.Event;
  import flash.events.IOErrorEvent;

  [BridgeNamespace("bank")]
  public class Bank
  {
    private static var items:Array = [];
    private static var loaded:Boolean = false;
    private static var loading:Boolean = false;

    private static function labelForView(view:String):String
    {
      return view == "house" ? "HouseBank" : "Bank";
    }

    private static function failLoad(message:String):void
    {
      loading = false;
      loaded = false;
      Main.getInstance().emitDebug("Bank load failed: " + message);
    }

    private static function onLoadComplete(event:Event):void
    {
      try
      {
        var response:Object = JSON.parse(event.target.data);
        if (!(response is Array))
        {
          failLoad("invalid response");
          return;
        }

        var snapshot:Array = response as Array;
        Main.Game.world.addItemsToBank(snapshot);
        items = snapshot;
        loading = false;
        loaded = true;
      }
      catch (error:Error)
      {
        failLoad(error.message);
      }
    }

    private static function onLoadError(event:IOErrorEvent):void
    {
      failLoad(event.text);
    }

    [BridgeExport]
    public static function getItems():Array
    {
      return items;
    }

    [BridgeTsParamType("selector: FlashTypes.InventoryItemSelector")]
    [BridgeExport]
    public static function getItem(selector:Object):Object
    {
      var game:Object = Main.Game;
      if (!game.world.bankinfo)
      {
        return null;
      }

      var itemId:Number = ItemLookup.toItemId(selector);
      if (!isNaN(itemId) && game.world.bankinfo.getBankItem is Function)
      {
        var bankItem:Object = game.world.bankinfo.getBankItem(int(itemId));
        if (bankItem)
        {
          return bankItem;
        }
      }

      return ItemLookup.find(game.world.bankinfo.items, selector);
    }

    [BridgeTsParamType("selector: FlashTypes.InventoryItemSelector")]
    [BridgeExport]
    public static function contains(selector:Object, quantity:int = 1):Boolean
    {
      var itemObj:Object = getItem(selector);
      if (!itemObj)
      {
        return false;
      }

      return itemObj.iQty >= quantity;
    }

    [BridgeExport]
    public static function loadItems(force:Boolean = false):void
    {
      var game:Object = Main.Game;
      if (loading || (loaded && !force))
      {
        return;
      }

      loaded = false;
      loading = true;
      game.requestAPI(
        "bank",
        {"layout":{"cat":"all"}},
        onLoadComplete,
        onLoadError,
        true
      );
    }

    [BridgeExport]
    public static function isLoaded():Boolean
    {
      return loaded;
    }

    [BridgeExport]
    public static function getSlots():int
    {
      var game:Object = Main.Game;
      return game.world.myAvatar.objData.iBankSlots;
    }

    [BridgeExport]
    public static function getUsedSlots():int
    {
      var game:Object = Main.Game;
      return game.world.myAvatar.iBankCount;
    }

    [BridgeTsParamType("selector: FlashTypes.InventoryItemSelector")]
    [BridgeExport]
    public static function deposit(selector:Object):Boolean
    {
      var item:Object = Inventory.getItem(selector);
      if (!item)
      {
        return false;
      }

      var game:Object = Main.Game;
      game.world.sendBankFromInvRequest(item);
      return true;
    }

    [BridgeTsParamType("selector: FlashTypes.InventoryItemSelector")]
    [BridgeExport]
    public static function withdraw(selector:Object):Boolean
    {
      var item:Object = getItem(selector);
      if (!item)
      {
        return false;
      }

      var game:Object = Main.Game;
      game.world.sendBankToInvRequest(item);
      return true;
    }

    [BridgeTsParamType("inventorySelector: FlashTypes.InventoryItemSelector")]
    [BridgeTsParamType("bankSelector: FlashTypes.InventoryItemSelector")]
    [BridgeExport]
    public static function swap(inventorySelector:Object, bankSelector:Object):Boolean
    {
      var invItem:Object = Inventory.getItem(inventorySelector);
      var bankItem:Object = getItem(bankSelector);

      if (!invItem || !bankItem)
      {
        return false;
      }

      var game:Object = Main.Game;
      game.sfc.sendXtMessage(
        "zm",
        "bankSwapInv",
        [invItem.ItemID, invItem.CharItemID, bankItem.ItemID, bankItem.CharItemID],
        "str",
        game.world.curRoom
      );
      return true;
    }

    [BridgeTsParamType("view: FlashTypes.BankView")]
    [BridgeExport]
    public static function open(view:String = "regular"):void
    {
      var game:Object = Main.Game;
      var label:String = labelForView(view);
      if (!game.world.uiLock && game.ui.mcPopup.currentLabel != label)
      {
        game.ui.mcPopup.fOpen(label);
      }
    }

    [BridgeTsParamType("view: FlashTypes.BankView")]
    [BridgeExport]
    public static function isOpen(view:String = null):Boolean
    {
      var game:Object = Main.Game;
      var currentLabel:String = game.ui.mcPopup.currentLabel;
      if (view == null)
      {
        return currentLabel == "Bank" || currentLabel == "HouseBank";
      }

      return currentLabel == labelForView(view);
    }

    [BridgeIgnore]
    public static function onLogout():void
    {
      items = [];
      loaded = false;
      loading = false;
    }
  }
}
