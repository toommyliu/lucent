package lucent.game {
  import lucent.Main;

  [BridgeNamespace("combat")]
  public class Combat {
    private static const CONSUMABLE_SKILL_INDEX:int = 5;

    private static function isMonsterAttackable(monster:Object):Boolean {
      if (monster == null || monster.dataLeaf == null) {
        return false;
      }

      return monster.dataLeaf.intState > 0 && monster.dataLeaf.intHP > 0;
    }

    private static function getSkillCooldownRemainingValue(skill:*):int {
      var game:* = Main.Game;

      var actionCooldown:* = NaN;
      var now:* = new Date().getTime();
      var haste:* = 1 - Math.min(Math.max(game.world.myAvatar.dataLeaf.sta.$tha, -1), 0.5);
      if (skill.OldCD != null) {
        actionCooldown = Math.round(skill.OldCD * haste);
      }
      else {
        actionCooldown = Math.round(skill.cd * haste);
      }

      var globalCooldown:* = game.world.GCD - (now - game.world.GCDTS);
      if (globalCooldown < 0) {
        globalCooldown = 0;
      }

      var remaining:* = actionCooldown - (now - skill.ts);
      if (remaining < 0) {
        remaining = 0;
      }

      return Math.max(globalCooldown, remaining);
    }

    [BridgeExport]
    public static function hasTarget():Boolean {
      var game:Object = Main.Game;
      var target:Object = game.world.myAvatar.target;
      if (target != null && target.dataLeaf != null) {
        return target.dataLeaf.intHP > 0;
      }

      return false;
    }

    [BridgeExport]
    [BridgeTsReturnType("FlashTypes.TargetInfo | null")]
    public static function getTarget():Object {
      var game:Object = Main.Game;
      var target:Object = game.world.myAvatar.target;
      if (target != null) {
        var dataLeaf:Object = target.dataLeaf;
        var objData:Object = target.objData;

        if (!dataLeaf || !objData) {
          return null;
        }

        if (target.npcType == "monster") {
          return {
            type: "monster",
            hp: dataLeaf.intHP,
            maxHp: dataLeaf.intHPMax,
            state: dataLeaf.intState,
            cell: dataLeaf.strFrame,
            monsterId: dataLeaf.MonID,
            monsterMapId: dataLeaf.MonMapID,
            level: dataLeaf.iLvl,
            race: objData.sRace,
            name: objData.strMonName
          };
        }

        if (target.npcType == "player") {
          return {
            type: "player",
            hp: dataLeaf.intHP,
            maxHp: dataLeaf.intHPMax,
            state: dataLeaf.intState,
            cell: dataLeaf.strFrame,
            afk: dataLeaf.afk,
            entityId: dataLeaf.entID,
            entityType: dataLeaf.entType,
            level: dataLeaf.intLevel,
            mp: dataLeaf.intMP,
            maxMp: dataLeaf.intMPMax,
            sp: dataLeaf.intSP,
            pad: dataLeaf.strPad,
            username: dataLeaf.strUsername,
            name: dataLeaf.uoName
          };
        }
      }

      return null;
    }

    [BridgeExport]
    public static function forceUseSkill(index:String):void {
      var game:Object = Main.Game;
      var skill:Object = game.world.actions.active[parseInt(index)];
      if (!skill) {
        return;
      }

      if (getSkillCooldownRemainingValue(skill) == 0) {
        if (game.world.myAvatar.dataLeaf.intMP >= skill.mp) {
          if (skill.isOK && !skill.skillLock) {
            game.world.testAction(skill);
          }
        }
      }
    }

    [BridgeExport]
    [BridgeTsReturnType("FlashTypes.ConsumableSkillItem | null")]
    public static function getConsumableSkillItem():Object {
      var game:Object = Main.Game;
      if (!game.world.actions || !game.world.actions.active) {
        return null;
      }

      var skill:Object = game.world.actions.active[CONSUMABLE_SKILL_INDEX];
      if (!skill || skill.ref != "i1" || skill.sArg1 == null) {
        return null;
      }

      var itemId:Number = Number(skill.sArg1);
      if (isNaN(itemId) || itemId <= 0) {
        return null;
      }

      return { itemId: itemId };
    }

    [BridgeExport]
    public static function useSkill(index:String):void {
      var game:Object = Main.Game;
      var skill:Object = game.world.actions.active[parseInt(index)];
      if (!skill) {
        return;
      }

      if (skill.tgt == "s" || skill.tgt == "f") {
        forceUseSkill(index);
        return;
      }

      if (game.world.myAvatar.target == game.world.myAvatar) {
        game.world.myAvatar.target = null;
        return;
      }

      if (game.world.myAvatar.target != null && game.world.myAvatar.target.dataLeaf.intHP > 0) {
        game.world.approachTarget();
        forceUseSkill(index);
      }
    }

    [BridgeExport]
    public static function getSkillCooldownRemaining(index:int):int {
      var game:Object = Main.Game;
      var skill:* = game.world.actions.active[index];
      if (!skill) {
        return 0;
      }

      return getSkillCooldownRemainingValue(skill);
    }

    [BridgeExport]
    public static function cancelAutoAttack():void {
      var game:Object = Main.Game;
      game.world.cancelAutoAttack();
    }

    [BridgeExport]
    public static function cancelTarget():void {
      var game:Object = Main.Game;
      game.world.cancelTarget(); // cancel auto attack
      game.world.cancelTarget(); // cancel target
    }

    [BridgeTsParamType("selector: FlashTypes.MonsterSelector")]
    [BridgeExport]
    public static function attackMonster(selector:Object):void {
      if (!selector)
        return;

      var game:Object = Main.Game;
      var monster:Object = World.getMonster(selector);
      if (isMonsterAttackable(monster)) {
        game.world.setTarget(monster);
        game.world.approachTarget();
      }
    }
  }
}
