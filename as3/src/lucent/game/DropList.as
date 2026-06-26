package lucent.game {
  import lucent.Main;
  import flash.events.MouseEvent;
  import flash.utils.getQualifiedClassName;

  [BridgeNamespace("drops")]
  public class DropList {
    private static const DROP_MC:String = "DFrame2MC";

    private static function getItemId(item:Object):int {
      if (!item || !("ItemID" in item)) {
        return 0;
      }

      return int(item.ItemID);
    }

    private static function isDefaultDropFrame(child:*):Boolean {
      return getQualifiedClassName(child) == DROP_MC && Boolean(child.fData);
    }

    private static function getCustomDropItem(itemId:int):Object {
      var game:Object = Main.Game;
      if (!game.cDropsUI || !(game.cDropsUI.invTree is Array)) {
        return null;
      }

      for each (var item:Object in game.cDropsUI.invTree) {
        if (item && int(item.ItemID) == itemId) {
          return item;
        }
      }

      return null;
    }

    private static function getCustomDropEntry(itemId:int):* {
      var source:* = getCustomDropSource();
      if (!source) {
        return null;
      }

      for (var i:int = 0; i < source.numChildren; i++) {
        var child:* = source.getChildAt(i);
        if (child.itemObj && int(child.itemObj.ItemID) == itemId) {
          return child;
        }
      }

      return null;
    }

    private static function getDefaultDropFrame(itemId:int):* {
      var game:Object = Main.Game;
      var children:int = game.ui.dropStack.numChildren;
      for (var i:int = 0; i < children; i++) {
        var child:* = game.ui.dropStack.getChildAt(i);
        if (isDefaultDropFrame(child) && int(child.fData.ItemID) == itemId) {
          return child;
        }
      }

      return null;
    }

    [BridgeExport]
    public static function acceptDrop(itemId:int):void {
      var game:Object = Main.Game;
      if (isUsingCustomDrops()) {
        var itemObj:* = getCustomDropItem(itemId);
        if (!itemObj)
          return;

        if (!isCustomDropsUiOpen())
          toggleUi();

        game.cDropsUI.acceptDrop(itemObj);
        game.sfc.sendXtMessage("zm", "getDrop", [itemId], "str", game.world.curRoom);
      }
      else {
        var frame:* = getDefaultDropFrame(itemId);
        if (frame)
          frame.cnt.ybtn.dispatchEvent(new MouseEvent(MouseEvent.CLICK));
      }
    }

    [BridgeExport]
    public static function toggleUi():void {
      var game:Object = Main.Game;
      if (isDraggable()) {
        game.cDropsUI.mcDraggable.menuBar.dispatchEvent(new MouseEvent(MouseEvent.CLICK));
      }
      else if (isUsingCustomDrops()) {
        game.cDropsUI.onShow();
      }
    }

    [BridgeExport]
    public static function rejectDrop(itemId:int):void {
      if (isUsingCustomDrops()) {
        if (!isCustomDropsUiOpen())
          toggleUi();

        var entry:* = getCustomDropEntry(itemId);
        if (entry)
          entry.btNo.dispatchEvent(new MouseEvent(MouseEvent.CLICK));

        return;
      }

      var frame:* = getDefaultDropFrame(itemId);
      if (frame)
        frame.cnt.nbtn.dispatchEvent(new MouseEvent(MouseEvent.CLICK));
    }

    [BridgeExport]
    public static function isUsingCustomDrops():Boolean {
      var game:Object = Main.Game;
      return Boolean(game.cDropsUI) && game.litePreference.data.bCustomDrops;
    }

    [BridgeIgnore]
    public static function isDraggable():Boolean {
      var game:Object = Main.Game;
      return isUsingCustomDrops() && Boolean(game.cDropsUI.mcDraggable);
    }

    private static function getCustomDropSource():* {
      var game:Object = Main.Game;
      if (isDraggable())
        return game.cDropsUI.mcDraggable.menu;
      else if (isUsingCustomDrops())
        return game.cDropsUI;

      return null;
    }

    [BridgeIgnore]
    public static function isCustomDropsUiOpen():Boolean {
      var game:Object = Main.Game;
      if (game.cDropsUI)
        return game.cDropsUI.isMenuOpen();

      return false;
    }
  }
}
