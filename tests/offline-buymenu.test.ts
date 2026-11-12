import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDS, mergeKeybinds } from '../src/core/Config';
import { UEBUNGSANLAGE_MAP } from '../src/data/maps';
import { WEAPONS } from '../src/data/weapons';
import { LocalSession } from '../src/game/LocalSession';
import { initRapier } from '../src/physics/PhysicsWorld';

describe('Offline Training BuyMenu & Keybind Integration', () => {
  beforeAll(async () => {
    await initRapier();
  });

  it('uses KeyB as default buyMenu keybind and supports custom keybind overrides', () => {
    expect(DEFAULT_KEYBINDS.buyMenu).toBe('KeyB');
    const custom = mergeKeybinds({ buyMenu: 'KeyG' });
    expect(custom.buyMenu).toBe('KeyG');
    expect(custom.moveForward).toBe(DEFAULT_KEYBINDS.moveForward);
  });

  it('equips any weapon immediately in LocalSession during offline training', () => {
    const session = new LocalSession(UEBUNGSANLAGE_MAP);

    session.equipWeapon('falke');
    expect(session.weapon.weaponId).toBe('falke');
    expect(session.getWeaponStats().id).toBe('falke');
    expect(session.weapon.ammoInMag).toBe(WEAPONS.falke.magSize);

    session.equipWeapon('bolzer');
    expect(session.weapon.weaponId).toBe('bolzer');
    expect(session.weapon.ammoInMag).toBe(WEAPONS.bolzer.magSize);

    session.equipWeapon('hornisse');
    expect(session.weapon.weaponId).toBe('hornisse');
    expect(session.weapon.ammoInMag).toBe(WEAPONS.hornisse.magSize);

    session.dispose();
  });

  it('supports free shield application and full ability refill in LocalSession', () => {
    const session = new LocalSession(UEBUNGSANLAGE_MAP);

    expect(session.playerShield).toBe(0);
    session.playerShield = 25;
    expect(session.playerShield).toBe(25);
    session.playerShield = 50;
    expect(session.playerShield).toBe(50);

    session.chargesQ = 0;
    session.chargesE = 0;
    session.ultPoints = 0;
    session.refillFullAbilities();

    const state = session.getAbilityState();
    expect(state.qCharges).toBe(state.qMax);
    expect(state.eCharges).toBe(state.eMax);
    expect(state.ultPoints).toBe(state.ultMax);

    session.dispose();
  });
});
