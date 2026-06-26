package lucent.game
{
  import lucent.Main;
  import flash.events.MouseEvent;

  [BridgeNamespace("auth")]
  public class Auth
  {

    [BridgeExport]
    public static function isLoggedIn():Boolean
    {
      var game:Object = Main.Game;
      return game !== null && game.sfc !== null && game.sfc.isConnected;
    }

    [BridgeExport]
    public static function isTemporarilyKicked():Boolean
    {
      var game:Object = Main.Game;
      var mcLogin:* = game.mcLogin;
      return mcLogin !== null && mcLogin.btnLogin !== null &&
        !mcLogin.btnLogin.visible;
    }

    [BridgeExport]
    public static function login(username:String, password:String):void
    {
      var game:Object = Main.Game;
      if (game.mcLogin == null || game.mcLogin.btnLogin == null)
      {
        game.removeAllChildren();
        game.gotoAndPlay("Login");
      }
      game.login(username, password);
    }

    [BridgeExport]
    public static function logout():void
    {
      var game:Object = Main.Game;
      if (game.sfc.isConnected)
      {
        game.sfc.disconnect();
      }
      game.removeAllChildren();
      game.gotoAndPlay("Login");
    }

    [BridgeExport]
    public static function getServers():Array
    {
      var game:Object = Main.Game;
      if (game.serialCmd != null && game.serialCmd.servers is Array)
      {
        return game.serialCmd.servers;
      }

      return null;
    }

    private static function connectResult(status:String, message:String, serverName:String = null, reason:String = null):Object
    {
      var result:Object = {
        ok: status == "selected",
        status: status,
        message: message
      };

      if (reason != null)
      {
        result.reason = reason;
      }

      if (serverName != null)
      {
        result.serverName = serverName;
      }

      return result;
    }

    private static function getServerListSource(currentGame:*):*
    {
      return Main.resolvePath(currentGame, ["mcLogin", "sl", "iList"], true);
    }

    private static function getLoginInfo(currentGame:*):Object
    {
      var login:Object = Main.resolvePath(currentGame, ["objLogin"], true);
      if (login != null)
      {
        return login;
      }

      try
      {
        var gameClass:Class = Class(Main.getInstance().getGameDomain().getDefinition("Game"));
        login = gameClass["objLogin"];
      }
      catch (e:Error)
      {
        login = null;
      }

      return login;
    }

    private static function getServerData(row:*):Object
    {
      return Main.resolvePath(row, ["obj"], true);
    }

    private static function getServerName(row:*):String
    {
      var data:Object = getServerData(row);
      if (data != null && data.sName is String)
      {
        return data.sName;
      }

      var label:* = Main.resolvePath(row, ["tName", "ti", "text"], true);
      return label is String ? label : "";
    }

    private static function rowMatches(row:*, normalizedServer:String, exact:Boolean):Boolean
    {
      var rowName:String = getServerName(row).toLowerCase();
      if (rowName == "")
      {
        return false;
      }

      if (exact)
      {
        return rowName == normalizedServer;
      }

      return rowName.indexOf(normalizedServer) > -1;
    }

    private static function findServerRow(source:*, normalizedServer:String, exact:Boolean):*
    {
      for (var i:int = 0; i < source.numChildren; i++)
      {
        var row:* = source.getChildAt(i);
        if (rowMatches(row, normalizedServer, exact))
        {
          return row;
        }
      }

      return null;
    }

    private static function serverSelectionFailure(selected:Object, login:Object, serverName:String):Object
    {
      if (selected.bOnline == 0)
      {
        return connectResult("blocked", "server is offline", serverName, "offline");
      }

      if (selected.iCount >= selected.iMax)
      {
        return connectResult("blocked", "server is full", serverName, "full");
      }

      if (login != null && selected.iChat > 0 && login.bCCOnly == 1)
      {
        return connectResult("blocked", "account is restricted to canned-chat servers", serverName, "chat-restricted");
      }

      if (login != null && selected.iChat > 0 && login.iAge < 13 && login.iUpgDays < 0)
      {
        return connectResult("blocked", "account is not authorized for chat-enabled servers", serverName, "underage-chat");
      }

      if (login != null && selected.bUpg == 1 && login.iUpgDays < 0)
      {
        return connectResult("blocked", "account is not authorized for member-only servers", serverName, "member-only");
      }

      // Intentional check.
      if (selected.iMax % 2 > 0)
      {
        return connectResult("blocked", "server requires the testing game client", serverName, "test-client-required");
      }

      if (login != null && selected.iLevel > 0 && login.iEmailStatus <= 2)
      {
        return connectResult("blocked", "server requires a confirmed email address", serverName, "email-unconfirmed");
      }

      return null;
    }

    [BridgeExport]
    [BridgeTsReturnType("FlashTypes.ConnectToSelectionResult | null")]
    public static function connectTo(server:String):Object
    {
      var result:Object;
      try
      {
        result = connectToUnsafe(server);
      }
      catch (e:Error)
      {
        result = connectResult("not-ready", "server selection failed");
      }

      return result;
    }

    private static function connectToUnsafe(server:String):Object
    {
      if (!server)
      {
        return connectResult("not-found", "server is required");
      }

      var currentGame:* = Main.Game;
      var source:* = getServerListSource(currentGame);
      if (source == null)
      {
        return connectResult("not-ready", "server selection is not ready");
      }

      server = server.toLowerCase();
      var child:* = findServerRow(source, server, true);
      if (child == null)
      {
        child = findServerRow(source, server, false);
      }

      if (child == null)
      {
        return connectResult("not-found", "server was not found");
      }

      var selected:Object = getServerData(child);
      if (selected == null)
      {
        return connectResult("not-found", "server was not found");
      }

      var serverName:String = getServerName(child);
      var failure:Object = serverSelectionFailure(selected, getLoginInfo(currentGame), serverName);
      if (failure != null)
      {
        return failure;
      }

      child.dispatchEvent(new MouseEvent(MouseEvent.CLICK));
      return connectResult("selected", "server selected", serverName);
    }
  }
}
