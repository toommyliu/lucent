package lucent.game
{
import lucent.Main;
import flash.display.DisplayObject;

[BridgeNamespace("world")]
public class World
  {
    private static var padNames:RegExp = /(Spawn|Center|Left|Right|Up|Down|Top|Bottom)/;

    private static function getStringSelector(selector:Object, key:String):String
    {
      var value:* = selector[key];
      if (!(value is String))
      {
        return null;
      }

      return String(value);
    }

    private static function getNumberSelector(selector:Object, key:String):Number
    {
      var value:* = selector[key];
      if (!(value is Number) && !(value is int) && !(value is uint))
      {
        return NaN;
      }

      return Number(value);
    }

    [BridgeExport]
    public static function isLoaded():Boolean
    {
      var game:Object = Main.Game;
      if (!game.world.mapLoadInProgress)
      {
        try
        {
          return game.getChildAt((game.numChildren - 1)) != game.mcConnDetail;
        }
        catch (e:Error)
        {
          return false;
        }
      }

      return false;
    }


    [BridgeExport]
    public static function isActionAvailable(gameAction:String):Boolean
    {
      var game:Object = Main.Game;
      var _loc_2:* = undefined;
      var _loc_3:* = undefined;
      var _loc_4:* = undefined;
      var _loc_5:* = undefined;
      _loc_2 = game.world.lock[gameAction];
      _loc_3 = new Date();
      _loc_4 = _loc_3.getTime();
      _loc_5 = _loc_4 - _loc_2.ts;
      return _loc_5 < _loc_2.cd ? false : true;
    }

    [BridgeExport]
    public static function isMonsterAvailable(monMapId:Number):Boolean
    {
      var game:Object = Main.Game;
      var monster:Object = game.world.getMonster(monMapId);
      if (!monster)
      {
        return false;
      } 

      return Boolean(monster.pMC) && monster.pMC.visible && monster.dataLeaf.intState > 0;
    }

    [BridgeExport]
    [BridgeTsReturnType("number[]")]
    public static function getAvailableMonsterMapIds():Array
    {
      var game:Object = Main.Game;
      var ids:Array = [];

      for each (var mon:Object in game.world.getMonstersByCell(game.world.strFrame))
      {
        if (!mon || !mon.dataLeaf)
        {
          continue;
        }

        var monMapId:Number = Number(mon.dataLeaf.MonMapID);
        if (!isNaN(monMapId) && isMonsterAvailable(monMapId))
        {
          ids.push(monMapId);
        }
      }

      return ids;
    }

    private static function getMonsterByName(name:String):Object
    {
      if (!name)
      {
        return null;
      }

      var game:Object = Main.Game;
      name = name.toLowerCase();
      for each (var mon:Object in game.world.getMonstersByCell(game.world.strFrame))
      {
        if (mon.pMC)
        {
          var monsterName:String = mon.pMC.pname.ti.text.toLowerCase();
          if (((monsterName.indexOf(name) > -1) || (name == "*")) && mon.dataLeaf.intState > 0)
          {
            return mon;
          }
        }
      }

      return null;
    }


    private static function getMonsterByMonMapId(monMapId:Number):Object
    {
      if (isNaN(monMapId) || monMapId <= 0)
      {
        return null;
      }

      var game:Object = Main.Game;
      for each (var mon:Object in game.world.getMonstersByCell(game.world.strFrame))
      {
        if (mon.pMC)
        {
          if (mon != null && mon.dataLeaf != null && mon.dataLeaf.MonMapID == monMapId)
          {
            return mon;
          }
        }
      }

      return null;
    }


    [BridgeTsParamType("selector: FlashTypes.MonsterSelector")]
    [BridgeExport]
    public static function getMonster(selector:Object):Object
    {
      if (!selector)
      {
        return null;
      }

      if ("name" in selector)
      {
        return getMonsterByName(getStringSelector(selector, "name"));
      }

      if ("monMapId" in selector)
      {
        return getMonsterByMonMapId(getNumberSelector(selector, "monMapId"));
      }

      return null;
    }


    [BridgeExport]
    public static function getCells():Array
    {
      var game:Object = Main.Game;
      var cells:Array = [];
      for each (var cell:Object in game.world.map.currentScene.labels)
      {
        cells.push(cell.name);
      }
      return cells;
    }


    [BridgeExport]
    public static function getCellPads():Array
    {
      var game:Object = Main.Game;
      var cellPads:Array = new Array();
      var cellPadsCnt:int = game.world.map.numChildren;
      for (var i:int = 0; i < cellPadsCnt; ++i)
      {
        var child:DisplayObject = game.world.map.getChildAt(i);
        if (padNames.test(child.name))
        {
          cellPads.push(child.name);
        }
      }

      return cellPads;
    }

    [BridgeExport]
    public static function reload():void
    {
      var game:Object = Main.Game;
      game.world.reloadCurrentMap();
    }


    [BridgeExport]
    public static function loadSwf(swf:String):void
    {
      var game:Object = Main.Game;
      game.world.loadMap(swf);
    }


    [BridgeExport]
    public static function getMapItem(itemId:int):void
    {
      if (!itemId)
      {
        return;
      }

      var game:Object = Main.Game;
      game.world.getMapItem(itemId);
    }


    [BridgeExport]
    public static function setSpawnPoint(cell:String = null, pad:String = null):void
    {
      var game:Object = Main.Game;
      if (!cell)
      {
        cell = game.world.strFrame;
      }

      if (!pad)
      {
        pad = game.world.strPad;
      }

      game.world.setSpawnPoint(cell, pad);
    }
  }
}
