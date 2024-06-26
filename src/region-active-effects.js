const { RegionBehaviorType } = foundry.data.regionBehaviors;
const { BooleanField, DocumentUUIDField, StringField } = foundry.data.fields;

Hooks.once("init", () => {
  // register the DataModel
  Object.assign(CONFIG.RegionBehavior.dataModels, {
    "region-active-effects.statusEffect": StatusEffectRegionBehaviorType,
    "region-active-effects.statusEffectEvents": StatusEffectEventsRegionBehaviorType,
    "region-active-effects.activeEffect": ActiveEffectRegionBehaviorType,
    "region-active-effects.activeEffectEvents": ActiveEffectEventsRegionBehaviorType,
  });

  // register the Sheet
  DocumentSheetConfig.registerSheet(
    RegionBehavior,
    "region-active-effects",
    foundry.applications.sheets.RegionBehaviorConfig,
    {
      types: [
        "region-active-effects.statusEffect",
        "region-active-effects.statusEffectEvents",
        "region-active-effects.activeEffect",
        "region-active-effects.activeEffectEvents",
      ],
      makeDefault: true,
    }
  );
});

function statusEffectChoices() {
  return CONFIG.statusEffects.reduce((obj, statusEffect) => {
    obj[statusEffect.id] = statusEffect.name;
    return obj;
  }, {});
}

/**
 * The data model for a behavior that applies a status effect while inside the Region.
 */
class StatusEffectRegionBehaviorType extends RegionBehaviorType {
  static defineSchema() {
    return {
      statusId: new StringField({
        required: true,
        blank: false,
        nullable: true,
        initial: null,
        choices: statusEffectChoices,
        label: "RAE.TYPES.statusEffect.FIELDS.statusId.label",
        hint: "RAE.TYPES.statusEffect.FIELDS.statusId.hint",
      }),
      overlay: new BooleanField({
        initial: false,
        label: "RAE.TYPES.statusEffect.FIELDS.overlay.label",
        hint: "RAE.TYPES.statusEffect.FIELDS.overlay.hint",
      }),
    };
  }

  static async #onTokenEnter(event) {
    // quick data verification
    const actor = event.data?.token?.actor;
    if (!actor || !this.statusId) return;

    // only run on triggering user
    if (!event.user.isSelf) return;

    actor.toggleStatusEffect(this.statusId, { active: true, overlay: this.overlay });
  }

  static async #onTokenExit(event) {
    // quick data verification
    const actor = event.data?.token?.actor;
    if (!actor || !this.statusId) return;

    // only run on triggering user
    if (!event.user.isSelf) return;

    actor.toggleStatusEffect(this.statusId, { active: false });
  }

  static events = {
    [CONST.REGION_EVENTS.TOKEN_ENTER]: this.#onTokenEnter,
    [CONST.REGION_EVENTS.TOKEN_EXIT]: this.#onTokenExit,
  };
}

/**
 * The data model for a behavior that toggles, adds, or removes a status effect based on the subscribed event.
 */
class StatusEffectEventsRegionBehaviorType extends RegionBehaviorType {
  static defineSchema() {
    return {
      events: this._createEventsField(),
      statusId: new StringField({
        required: true,
        blank: false,
        nullable: true,
        initial: null,
        choices: statusEffectChoices,
        label: "RAE.TYPES.statusEffect.FIELDS.statusId.label",
        hint: "RAE.TYPES.statusEffect.FIELDS.statusId.hint",
      }),
      action: new StringField({
        required: true,
        blank: false,
        nullable: false,
        initial: "toggle",
        choices: {
          toggle: "RAE.TYPES.statusEffectEvents.FIELDS.action.choices.toggle",
          apply: "RAE.TYPES.statusEffectEvents.FIELDS.action.choices.apply",
          remove: "RAE.TYPES.statusEffectEvents.FIELDS.action.choices.remove",
        },
        label: "RAE.TYPES.statusEffectEvents.FIELDS.action.label",
        hint: "RAE.TYPES.statusEffectEvents.FIELDS.action.hint",
      }),
      overlay: new BooleanField({
        initial: false,
        label: "RAE.TYPES.statusEffect.FIELDS.overlay.label",
        hint: "RAE.TYPES.statusEffect.FIELDS.overlay.hint",
      }),
    };
  }

  async _handleRegionEvent(event) {
    // quick data verification
    const actor = event.data?.token?.actor;
    if (!actor || !this.statusId) return;

    const active = this.action === "apply" ? true : this.action === "remove" ? false : undefined;
    actor.toggleStatusEffect(this.statusId, { active, overlay: this.overlay });
  }
}

async function applyEffectToActor(effect, actor, behavior) {
  // Enable an existing effect on the actor if it came from this behavior
  const existingEffect = actor.effects.find((e) => e.origin === behavior.uuid);
  if (existingEffect) {
    return existingEffect.update({ ...effect.constructor.getInitialDuration(), disabled: false });
  }

  // Create a new effect on the actor
  const effectData = {
    ...effect.toObject(),
    disabled: false,
    transfer: false,
    origin: behavior.uuid,
  };
  return ActiveEffect.implementation.create(effectData, { parent: actor });
}

class ActiveEffectRegionBehaviorType extends RegionBehaviorType {
  static defineSchema() {
    return {
      uuid: new DocumentUUIDField({
        type: "ActiveEffect",
        label: "RAE.TYPES.activeEffect.FIELDS.uuid.label",
        hint: "RAE.TYPES.activeEffect.FIELDS.uuid.hint",
      }),
      disable: new BooleanField({
        initial: false,
        label: "RAE.TYPES.activeEffect.FIELDS.disable.label",
        hint: "RAE.TYPES.activeEffect.FIELDS.disable.hint",
      }),
    };
  }

  static async #onTokenEnter(event) {
    // quick data verification
    const actor = event.data?.token?.actor;
    if (!actor || !this.uuid) return;

    // only run on triggering user
    if (!event.user.isSelf) return;

    const effect = await fromUuid(this.uuid);
    applyEffectToActor(effect, actor, this.behavior);
  }

  static async #onTokenExit(event) {
    // quick data verification
    const actor = event.data?.token?.actor;
    if (!actor || !this.uuid) return;

    // only run on triggering user
    if (!event.user.isSelf) return;

    const existingEffect = actor.effects.find((e) => e.origin === this.behavior.uuid);
    if (existingEffect && this.disable) existingEffect.update({ disabled: true });
    else if (existingEffect) existingEffect.delete();
  }

  static events = {
    [CONST.REGION_EVENTS.TOKEN_ENTER]: this.#onTokenEnter,
    [CONST.REGION_EVENTS.TOKEN_EXIT]: this.#onTokenExit,
  };
}

/**
 * Add an active effect (needs UUID)
 * Reset the duration of an active effect (needs UUID)
 * Enable/Disable an active effect (needs String for name)
 * Remove an active effect (needs String for name)
 */
class ActiveEffectEventsRegionBehaviorType extends RegionBehaviorType {
  static defineSchema() {
    return {
      events: this._createEventsField(),
      action: new StringField({
        required: true,
        blank: false,
        nullable: true,
        choices: {
          add: "Add",
          resetDuration: "Reset Duration",
          enable: "Enable",
          disable: "Disable",
          delete: "Delete",
        },
        label: "RAE.TYPES.activeEffectEvents.FIELDS.action.label",
        hint: "RAE.TYPES.activeEffectEvents.FIELDS.action.hint",
      }),
      uuid: new DocumentUUIDField({
        type: "ActiveEffect",
        label: "RAE.TYPES.activeEffect.FIELDS.uuid.label",
        hint: "RAE.TYPES.activeEffect.FIELDS.uuid.hint",
      }),
      name: new StringField({
        required: false,
        blank: false,
        nullable: false,
        label: "RAE.TYPES.activeEffectEvents.FIELDS.name.label",
        hint: "RAE.TYPES.activeEffectEvents.FIELDS.name.hint",
      }),
    };
  }

  static validateJoint(data) {
    if (["add", "resetDuration"].includes(data.action) && !data.uuid)
      throw new Error(`The uuid field is required for the ${data.action} action`);
    if (["enable", "disable", "delete"].includes(data.action) && !data.name)
      throw new Error(`The name field is required for the ${data.action} action`);
  }

  async _handleRegionEvent(event) {
    // quick data verification
    const actor = event.data?.token?.actor;
    if (!actor) return;

    // only run once by active GM
    if (!game.users.activeGM?.isSelf) return;

    switch (this.action) {
      case "add":
        const effect = await fromUuid(this.uuid);
        applyEffectToActor(effect, actor, this.parent);
        break;
      case "resetDuration":
        this.#onResetDuration(actor);
        break;
      case "enable":
        this.#onEnableDisable(actor, false);
        break;
      case "disable":
        this.#onEnableDisable(actor, true);
        break;
      case "delete":
        const existingEffect = actor.effects.getName(this.name);
        if (existingEffect) await existingEffect.delete();
        break;
    }
  }

  async #onResetDuration(actor) {
    const effect = await fromUuid(this.uuid);
    const existingEffect = actor.effects.getName(effect.name);
    if (existingEffect)
      return existingEffect.update({ ...effect.constructor.getInitialDuration() });
  }

  async #onEnableDisable(actor, disabled) {
    const existingEffect = actor.effects.getName(this.name);
    if (existingEffect) return existingEffect.update({ disabled });
  }
}
