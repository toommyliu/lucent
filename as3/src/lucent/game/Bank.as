package lucent.game
{
  import lucent.Main;
  import flash.display.MovieClip;

  [BridgeNamespace("bank")]
  public class Bank
  {
    private static var loaded:Boolean = false;

    [BridgeExport]
    public static function getItems():Array
    {
      var game:Object = Main.Game;
      if (!game.world.bankinfo || !(game.world.bankinfo.items is Array))
      {
        return [];
      }

      return game.world.bankinfo.items;
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
      if (loaded && !force)
      {
        return;
      }

      game.getBank();
      loaded = true;
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
      game.world.sendBankSwapInvRequest(bankItem, invItem);
      return true;
    }

    [BridgeExport]
    public static function open():void
    {
      var game:Object = Main.Game;
      if (!loaded)
      {
        loadItems();
      }
      if (!game.world.uiLock)
      {
        if (game.ui.mcPopup.currentLabel == "Bank")
        {
          MovieClip(game.ui.mcPopup.getChildByName("mcBank")).fClose();
        }
        else
        {
          game.ui.mcPopup.fOpen("Bank");
        }
      }
    }

    [BridgeExport]
    public static function isOpen():Boolean
    {
      var game:Object = Main.Game;
      return game.ui.mcPopup.currentLabel === "Bank";
    }

    [BridgeIgnore]
    public static function onLogout():void
    {
      loaded = false;
    }
  }
}
