import type { CharacterId, WeaponId } from '../core/types';
import type { RoleArchetype } from './characters';
import type { WeaponFinishId } from './progression';
import { WEAPON_FINISHES } from './progression';

export type CharacterRole = RoleArchetype;
export type WeaponIconId = WeaponId | 'knife';
export type AbilityIconSlot = 'q' | 'e' | 'ult' | 'x';

function resolveFinishAccent(finish?: WeaponFinishId): string {
  if (!finish || finish === 'standard') return 'currentColor';
  const found = WEAPON_FINISHES.find((f) => f.id === finish);
  return found ? found.accentHex : 'currentColor';
}

/**
 * Crisp horizontal side-profile SVG silhouettes for all 6 SHARDLINE weapons + 'knife'.
 * Uses `currentColor` so HUD, BuyMenu, and Arsenal cards can style hover/owned states cleanly via CSS.
 */
export function getWeaponSvg(id: WeaponIconId, finish?: WeaponFinishId): string {
  const accent = resolveFinishAccent(finish);
  const accentOpacity = finish && finish !== 'standard' ? '0.92' : '0.45';

  switch (id) {
    case 'funke':
      // Compact tactical semi-auto pistol
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 96" fill="none" aria-hidden="true" class="shard-svg shard-weapon-svg" data-weapon="funke">
        <path d="M52 24h98l12 6v14h-42l-7 8H91l-10 30H54l11-34-13-6V24Z" fill="currentColor" fill-opacity="0.92"/>
        <path d="M162 30h12v9h-12v-9ZM58 19h8v5h-8v-5Zm91 0h9v5h-9v-5Z" fill="currentColor"/>
        <path d="M89 44h24l-5 11H85l4-11Z" stroke="currentColor" stroke-width="3" fill="none"/>
        <path d="M64 31h76" stroke="${accent}" stroke-width="2.6" stroke-opacity="${accentOpacity}"/>
        <path d="M68 35v6m7-6v6m7-6v6m44 1h28" stroke="currentColor" stroke-width="2" stroke-opacity="0.38"/>
      </svg>`;

    case 'bolzer':
      // Heavy high-caliber bull-barrel sidearm
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 96" fill="none" aria-hidden="true" class="shard-svg shard-weapon-svg" data-weapon="bolzer">
        <path d="M44 27l8-7h132l12 5v17h-64l-9 9h-22l-13 33H58l12-35-16-8-10-14Z" fill="currentColor" fill-opacity="0.94"/>
        <rect x="84" y="25" width="32" height="16" rx="2" fill="currentColor" fill-opacity="0.32" stroke="currentColor" stroke-width="2"/>
        <path d="M196 27h10v13h-10V27ZM52 15h10l-4 6h-6v-6Zm128 0h9v5h-9v-5Z" fill="currentColor"/>
        <path d="M98 44h25l-5 12H93l5-12Z" stroke="currentColor" stroke-width="3"/>
        <path d="M124 31h58" stroke="${accent}" stroke-width="3" stroke-opacity="${accentOpacity}"/>
      </svg>`;

    case 'hornisse':
      // High-ROF compact SMG with skeleton stock & canted extended magazine
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 96" fill="none" aria-hidden="true" class="shard-svg shard-weapon-svg" data-weapon="hornisse">
        <path d="M22 30h42l6-7h116l10 6v14h-22v19h-11V43h-22l11 38h-16l-12-38h-18l-8 27H78l6-27H64l-8 10H22V30Z" fill="currentColor" fill-opacity="0.93"/>
        <path d="M30 35h26v12H30V35Z" fill="none" stroke="currentColor" stroke-width="2"/>
        <path d="M196 31h26v9h-26v-9Zm-88-15h26l5 7h-36l5-7Z" fill="currentColor"/>
        <path d="M84 43h22l-4 10H81l3-10Z" stroke="currentColor" stroke-width="2.6"/>
        <path d="M78 31h102" stroke="${accent}" stroke-width="2.8" stroke-opacity="${accentOpacity}"/>
      </svg>`;

    case 'brecher':
      // Tactical pump-action combat shotgun with twin barrel & ribbed forend
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 96" fill="none" aria-hidden="true" class="shard-svg shard-weapon-svg" data-weapon="brecher">
        <path d="M18 36l48-8h154v9H118l-9 9H84l-14 26H46l12-20-40 6V36Z" fill="currentColor" fill-opacity="0.94"/>
        <rect x="220" y="28" width="54" height="7" fill="currentColor"/>
        <rect x="220" y="37" width="46" height="6" fill="currentColor" fill-opacity="0.82"/>
        <path d="M142 38h68l-6 11h-56l-6-11Z" fill="currentColor"/>
        <path d="M90 45h22l-5 10H85l5-10Z" stroke="currentColor" stroke-width="2.6"/>
        <path d="M116 32h102" stroke="${accent}" stroke-width="3" stroke-opacity="${accentOpacity}"/>
      </svg>`;

    case 'lanze':
      // Precision long-barrel assault rifle (flagship SHARDLINE rifle)
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 330 96" fill="none" aria-hidden="true" class="shard-svg shard-weapon-svg" data-weapon="lanze">
        <path d="M16 31h58l10-7h148l10 6v12h-84l13 36h-19l-14-36h-22l-9 29H88l7-29H72l-14 14H16V31Z" fill="currentColor" fill-opacity="0.94"/>
        <rect x="242" y="30" width="60" height="6" fill="currentColor"/>
        <path d="M302 28h14v10h-14V28ZM116 15h38l6 9h-50l6-9Z" fill="currentColor"/>
        <path d="M95 42h24l-4 11H92l3-11Z" stroke="currentColor" stroke-width="2.6"/>
        <path d="M92 31h142" stroke="${accent}" stroke-width="3" stroke-opacity="${accentOpacity}"/>
      </svg>`;

    case 'falke':
      // Long-barrel bolt-action precision sniper rifle with telescopic optic & muzzle brake
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 96" fill="none" aria-hidden="true" class="shard-svg shard-weapon-svg" data-weapon="falke">
        <path d="M12 34h58l12-7h142l8 6v11h-76v16h-26V44h-20l-9 29H82l7-29H68l-14 15H12V34Z" fill="currentColor" fill-opacity="0.94"/>
        <rect x="232" y="32" width="96" height="5.5" fill="currentColor"/>
        <path d="M328 28h20v13h-20V28Z" fill="currentColor"/>
        <path d="M96 12h78l10 3v9l-10 3H96l-8-3v-9l8-3Zm18 15h8v5h-8v-5Zm42 0h8v5h-8v-5Z" fill="currentColor"/>
        <path d="M214 44l12 20h-7l-10-20h5Z" fill="currentColor" fill-opacity="0.8"/>
        <path d="M88 33h138" stroke="${accent}" stroke-width="2.8" stroke-opacity="${accentOpacity}"/>
      </svg>`;

    case 'knife':
      // Taktik-Klinge angular tanto combat blade with pommel ring
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 96" fill="none" aria-hidden="true" class="shard-svg shard-weapon-svg" data-weapon="knife">
        <circle cx="34" cy="50" r="11" stroke="currentColor" stroke-width="5"/>
        <path d="M44 43h50v-9h8v32h-8v-9H44V43Z" fill="currentColor"/>
        <path d="M102 38h92l28 11-36 13h-84V38Z" fill="currentColor" fill-opacity="0.94"/>
        <path d="M114 45h74" stroke="${accent}" stroke-width="2.8" stroke-opacity="${accentOpacity}"/>
      </svg>`;
  }
}

/**
 * Geometric hexagonal shield SVG with 25 (light) or 50 (heavy) segmented core.
 */
export function getArmorSvg(tier: 'light' | 'heavy' | 'none'): string {
  if (tier === 'none') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none" aria-hidden="true" class="shard-svg shard-armor-svg" data-armor="none">
      <polygon points="48,8 82,26 82,66 48,88 14,66 14,26" stroke="currentColor" stroke-width="3" stroke-dasharray="6 5" opacity="0.55"/>
      <text x="48" y="55" text-anchor="middle" fill="currentColor" font-size="20" font-family="monospace" font-weight="700" opacity="0.65">0</text>
    </svg>`;
  }

  if (tier === 'light') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none" aria-hidden="true" class="shard-svg shard-armor-svg" data-armor="light">
      <polygon points="48,8 82,26 82,66 48,88 14,66 14,26" stroke="currentColor" stroke-width="3.6" fill="currentColor" fill-opacity="0.1"/>
      <path d="M48 16L74 30v16H22V30L48 16Z" fill="currentColor" fill-opacity="0.32"/>
      <line x1="22" y1="48" x2="74" y2="48" stroke="currentColor" stroke-width="2.4" stroke-opacity="0.7"/>
      <text x="48" y="70" text-anchor="middle" fill="currentColor" font-size="21" font-family="sans-serif" font-weight="800">25</text>
    </svg>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none" aria-hidden="true" class="shard-svg shard-armor-svg" data-armor="heavy">
    <polygon points="48,6 84,25 84,67 48,90 12,67 12,25" stroke="currentColor" stroke-width="4" fill="currentColor" fill-opacity="0.16"/>
    <polygon points="48,14 76,29 76,63 48,81 20,63 20,29" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity="0.22"/>
    <path d="M24 34l24-12 24 12M24 60l24 14 24-14" stroke="currentColor" stroke-width="2.4"/>
    <text x="48" y="56" text-anchor="middle" fill="currentColor" font-size="22" font-family="sans-serif" font-weight="800">50</text>
  </svg>`;
}

/**
 * High-contrast 64x64 tactical vector icons for all 12 SHARDLINE abilities (`currentColor`).
 */
export function getAbilitySvg(character: CharacterId, slot: AbilityIconSlot): string {
  const normSlot: 'q' | 'e' | 'ult' = slot === 'x' ? 'ult' : slot;
  const key = `${character}_${normSlot}`;

  switch (key) {
    // RYO KADE (Vorstoß)
    case 'ryo_q': // Gleitschritt
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" aria-hidden="true" class="shard-svg shard-ability-svg">
        <path d="M12 18l16 14-16 14m14-28l16 14-16 14m14-28l14 14-14 14" stroke="currentColor" stroke-width="4.5" stroke-linecap="square"/>
        <line x1="6" y1="32" x2="22" y2="32" stroke="currentColor" stroke-width="3.5"/>
      </svg>`;
    case 'ryo_e': // Adrenalin
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" aria-hidden="true" class="shard-svg shard-ability-svg">
        <path d="M35 8L17 35h13l-3 21 20-27H34l1-21Z" fill="currentColor"/>
        <path d="M10 22l6-6m38 32l-6 6" stroke="currentColor" stroke-width="3.2"/>
      </svg>`;
    case 'ryo_ult': // Überlast
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" aria-hidden="true" class="shard-svg shard-ability-svg">
        <polygon points="32,6 54,19 54,45 32,58 10,45 10,19" stroke="currentColor" stroke-width="3.5"/>
        <path d="M32 14l7 13 13 5-13 5-7 13-7-13-13-5 13-5 7-13Z" fill="currentColor"/>
      </svg>`;

    // MIRA SOLEN (Aufklärer)
    case 'mira_q': // Echo-Puls
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" aria-hidden="true" class="shard-svg shard-ability-svg">
        <polygon points="32,23 41,32 32,41 23,32" fill="currentColor"/>
        <circle cx="32" cy="32" r="16" stroke="currentColor" stroke-width="3"/>
        <path d="M14 14a25.5 25.5 0 0 1 36 0M50 50a25.5 25.5 0 0 1-36 0" stroke="currentColor" stroke-width="3.2"/>
      </svg>`;
    case 'mira_e': // Störsender
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" aria-hidden="true" class="shard-svg shard-ability-svg">
        <rect x="24" y="20" width="16" height="24" rx="2" stroke="currentColor" stroke-width="3.4" fill="currentColor" fill-opacity="0.24"/>
        <path d="M32 10v10M8 26l10 4-6 8 10 2M56 26l-10 4 6 8-10 2" stroke="currentColor" stroke-width="3.2"/>
      </svg>`;
    case 'mira_ult': // Weitblick
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" aria-hidden="true" class="shard-svg shard-ability-svg">
        <path d="M6 32C14 18 23 13 32 13s18 5 26 19c-8 14-17 19-26 19S14 46 6 32Z" stroke="currentColor" stroke-width="3.6"/>
        <polygon points="32,21 43,32 32,43 21,32" fill="currentColor"/>
        <line x1="32" y1="6" x2="32" y2="11" stroke="currentColor" stroke-width="3"/>
        <line x1="32" y1="53" x2="32" y2="58" stroke="currentColor" stroke-width="3"/>
      </svg>`;

    // BRANN OKAFOR (Kontrolleur)
    case 'brann_q': // Nebelkuppel
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" aria-hidden="true" class="shard-svg shard-ability-svg">
        <path d="M10 44a22 22 0 0 1 44 0H10Z" fill="currentColor" fill-opacity="0.28" stroke="currentColor" stroke-width="3.6"/>
        <line x1="6" y1="50" x2="58" y2="50" stroke="currentColor" stroke-width="3.6"/>
        <line x1="16" y1="36" x2="48" y2="36" stroke="currentColor" stroke-width="2.8"/>
      </svg>`;
    case 'brann_e': // Glutfeld
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" aria-hidden="true" class="shard-svg shard-ability-svg">
        <polygon points="32,10 44,30 37,32 42,46 22,46 27,32 20,30" fill="currentColor"/>
        <polygon points="10,48 32,56 54,48 32,41" stroke="currentColor" stroke-width="3"/>
      </svg>`;
    case 'brann_ult': // Dunkelzone
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" aria-hidden="true" class="shard-svg shard-ability-svg">
        <circle cx="32" cy="32" r="23" stroke="currentColor" stroke-width="4.2"/>
        <circle cx="32" cy="32" r="12" stroke="currentColor" stroke-width="3" stroke-dasharray="6 4"/>
        <circle cx="32" cy="32" r="4.5" fill="currentColor"/>
      </svg>`;

    // TESSA VAHL (Wächter)
    case 'tessa_q': // Magnetanker
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" aria-hidden="true" class="shard-svg shard-ability-svg">
        <circle cx="32" cy="32" r="9" fill="currentColor"/>
        <circle cx="32" cy="32" r="20" stroke="currentColor" stroke-width="3"/>
        <path d="M32 6v10M32 48v10M6 32h10M48 32h10" stroke="currentColor" stroke-width="4"/>
      </svg>`;
    case 'tessa_e': // Schildpfosten
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" aria-hidden="true" class="shard-svg shard-ability-svg">
        <rect x="10" y="16" width="8" height="36" fill="currentColor"/>
        <rect x="46" y="16" width="8" height="36" fill="currentColor"/>
        <rect x="18" y="22" width="28" height="24" fill="currentColor" fill-opacity="0.28" stroke="currentColor" stroke-width="3"/>
        <path d="M22 28l20 12M42 28L22 40" stroke="currentColor" stroke-width="2.4"/>
      </svg>`;
    default: // tessa_ult: Bollwerk
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" aria-hidden="true" class="shard-svg shard-ability-svg">
        <path d="M32 8l22 9v17c0 12-9.5 20.5-22 24-12.5-3.5-22-12-22-24V17l22-9Z" stroke="currentColor" stroke-width="3.8" fill="currentColor" fill-opacity="0.22"/>
        <path d="M22 33l10-9 10 9M22 42l10-9 10 9" stroke="currentColor" stroke-width="3.4"/>
      </svg>`;
  }
}

/**
 * Distinct 48x48 role emblems for Vorstoß, Aufklärer, Kontrolleur, and Wächter.
 */
export function getRoleSvg(role: CharacterRole): string {
  switch (role) {
    case 'Vorstoß':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" aria-hidden="true" class="shard-svg shard-role-svg">
        <polygon points="24,4 42,24 24,44 6,24" stroke="currentColor" stroke-width="2.8"/>
        <path d="M16 28l8-11 8 11M16 35l8-10 8 10" stroke="currentColor" stroke-width="3.4"/>
      </svg>`;
    case 'Aufklärer':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" aria-hidden="true" class="shard-svg shard-role-svg">
        <circle cx="24" cy="24" r="16" stroke="currentColor" stroke-width="2.8"/>
        <polygon points="24,11 31,24 24,37 17,24" fill="currentColor"/>
        <line x1="4" y1="24" x2="11" y2="24" stroke="currentColor" stroke-width="2.8"/>
        <line x1="37" y1="24" x2="44" y2="24" stroke="currentColor" stroke-width="2.8"/>
      </svg>`;
    case 'Kontrolleur':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" aria-hidden="true" class="shard-svg shard-role-svg">
        <circle cx="24" cy="24" r="17" stroke="currentColor" stroke-width="3"/>
        <ellipse cx="24" cy="24" rx="8" ry="17" stroke="currentColor" stroke-width="2.4"/>
        <line x1="7" y1="24" x2="41" y2="24" stroke="currentColor" stroke-width="2.6"/>
      </svg>`;
    case 'Wächter':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" aria-hidden="true" class="shard-svg shard-role-svg">
        <polygon points="24,5 41,14 41,32 24,43 7,32 7,14" stroke="currentColor" stroke-width="3"/>
        <polygon points="24,14 33,19 33,29 24,35 15,29 15,19" fill="currentColor"/>
      </svg>`;
  }
}

/**
 * Geometric Kern reactor icon for HUD Match-Header & Kern action slot.
 */
export function getKernSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" aria-hidden="true" class="shard-svg shard-kern-svg">
    <polygon points="32,6 54,20 54,44 32,58 10,44 10,20" stroke="currentColor" stroke-width="3.6" fill="currentColor" fill-opacity="0.16"/>
    <polygon points="32,16 44,32 32,48 20,32" fill="currentColor"/>
  </svg>`;
}

/**
 * Large-format stylized geometric low-poly/vector character portraits (320x520)
 * for the 5-banner party lobby and Spezialisten showcase.
 */
export function getCharacterPortraitSvg(character: CharacterId): string {
  switch (character) {
    case 'ryo':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 520" fill="none" aria-hidden="true" class="shard-svg shard-portrait-svg" data-character="ryo">
        <defs>
          <linearGradient id="shard-port-ryo-bg" x1="160" y1="20" x2="160" y2="500" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#ff6b2b" stop-opacity="0.34"/>
            <stop offset="100%" stop-color="#0f1722" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="shard-port-ryo-suit" x1="90" y1="140" x2="230" y2="490" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#2c3746"/>
            <stop offset="100%" stop-color="#141c27"/>
          </linearGradient>
        </defs>
        <polygon points="160,24 286,150 242,492 78,492 34,150" fill="url(#shard-port-ryo-bg)"/>
        <path d="M58 210L160 44l102 166" stroke="#ff6b2b" stroke-width="2" stroke-opacity="0.45"/>
        <!-- High-collar kinetic vanguard jacket & shoulder thrusters -->
        <polygon points="62,232 118,186 202,186 258,232 238,504 82,504" fill="url(#shard-port-ryo-suit)" stroke="#ff6b2b" stroke-width="2.4"/>
        <polygon points="94,166 132,148 188,148 226,166 210,224 110,224" fill="#1f2937" stroke="#ff854d" stroke-width="2"/>
        <!-- Chest reactor chevron & harness -->
        <polygon points="118,242 160,272 202,242 190,330 160,356 130,330" fill="#ff6b2b" fill-opacity="0.22" stroke="#ff6b2b" stroke-width="2.5"/>
        <polygon points="146,278 160,290 174,278 160,318" fill="#ff6b2b"/>
        <!-- Stylized geometric head & glowing orange speed visor -->
        <polygon points="124,84 160,64 196,84 202,142 160,174 118,142" fill="#273242" stroke="#dce5ef" stroke-width="2"/>
        <polygon points="116,80 164,52 210,86 196,102 160,84 126,98" fill="#dce5ef"/>
        <polygon points="124,112 160,124 196,112 190,130 160,140 130,130" fill="#ff6b2b"/>
        <!-- Shoulder kinetic fins -->
        <polygon points="48,224 94,196 86,262 42,254" fill="#ff6b2b"/>
        <polygon points="272,224 226,196 234,262 278,254" fill="#ff6b2b"/>
      </svg>`;

    case 'mira':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 520" fill="none" aria-hidden="true" class="shard-svg shard-portrait-svg" data-character="mira">
        <defs>
          <linearGradient id="shard-port-mira-bg" x1="160" y1="20" x2="160" y2="500" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.34"/>
            <stop offset="100%" stop-color="#0f1722" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="shard-port-mira-cloak" x1="80" y1="120" x2="240" y2="500" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#243549"/>
            <stop offset="100%" stop-color="#111a26"/>
          </linearGradient>
        </defs>
        <circle cx="160" cy="186" r="118" stroke="#38bdf8" stroke-width="1.8" stroke-opacity="0.35" stroke-dasharray="10 7"/>
        <polygon points="160,28 282,164 238,496 82,496 38,164" fill="url(#shard-port-mira-bg)"/>
        <!-- Recon antenna mast -->
        <line x1="214" y1="54" x2="202" y2="192" stroke="#38bdf8" stroke-width="3.2"/>
        <circle cx="214" cy="52" r="5" fill="#38bdf8"/>
        <!-- Asymmetric recon cloak & sensor rig -->
        <polygon points="68,226 124,182 196,182 252,226 234,504 86,504" fill="url(#shard-port-mira-cloak)" stroke="#38bdf8" stroke-width="2.2"/>
        <polygon points="86,214 160,256 226,204 198,376 112,340" fill="#1b2b3d" stroke="#7dd3fc" stroke-width="1.8"/>
        <!-- Hooded head & dual cyan sensor optics -->
        <polygon points="106,108 160,56 214,108 206,186 114,186" fill="#1d2c3f" stroke="#38bdf8" stroke-width="2.4"/>
        <polygon points="128,98 160,78 192,98 188,154 160,174 132,154" fill="#2b3a4d"/>
        <polygon points="132,118 155,124 152,135 130,130" fill="#38bdf8"/>
        <polygon points="188,118 165,124 168,135 190,130" fill="#38bdf8"/>
        <circle cx="160" cy="288" r="20" stroke="#38bdf8" stroke-width="2.8" fill="#38bdf8" fill-opacity="0.2"/>
        <polygon points="160,276 172,288 160,300 148,288" fill="#38bdf8"/>
      </svg>`;

    case 'brann':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 520" fill="none" aria-hidden="true" class="shard-svg shard-portrait-svg" data-character="brann">
        <defs>
          <linearGradient id="shard-port-brann-bg" x1="160" y1="24" x2="160" y2="500" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.34"/>
            <stop offset="100%" stop-color="#0f1722" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="shard-port-brann-coat" x1="70" y1="150" x2="250" y2="504" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#35322f"/>
            <stop offset="100%" stop-color="#171920"/>
          </linearGradient>
        </defs>
        <polygon points="160,24 292,154 252,498 68,498 28,154" fill="url(#shard-port-brann-bg)"/>
        <!-- Shoulder smoke-launcher pods -->
        <rect x="64" y="164" width="38" height="54" rx="4" fill="#292e37" stroke="#f59e0b" stroke-width="2.4"/>
        <rect x="218" y="164" width="38" height="54" rx="4" fill="#292e37" stroke="#f59e0b" stroke-width="2.4"/>
        <!-- Broad heavy thermal coat & chest armor -->
        <polygon points="46,222 108,178 212,178 274,222 256,504 64,504" fill="url(#shard-port-brann-coat)" stroke="#f59e0b" stroke-width="2.5"/>
        <polygon points="104,218 216,218 204,358 116,358" fill="#242933" stroke="#fbbf24" stroke-width="2"/>
        <line x1="126" y1="258" x2="194" y2="258" stroke="#f59e0b" stroke-width="4"/>
        <line x1="126" y1="286" x2="194" y2="286" stroke="#f59e0b" stroke-width="4"/>
        <!-- Armored head & industrial thermal respirator -->
        <polygon points="122,76 160,60 198,76 204,146 160,178 116,146" fill="#2f3640" stroke="#e2e8f0" stroke-width="2"/>
        <polygon points="118,124 160,114 202,124 194,168 160,180 126,168" fill="#1e242d" stroke="#f59e0b" stroke-width="2.2"/>
        <rect x="132" y="102" width="56" height="12" fill="#f59e0b"/>
      </svg>`;

    case 'tessa':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 520" fill="none" aria-hidden="true" class="shard-svg shard-portrait-svg" data-character="tessa">
        <defs>
          <linearGradient id="shard-port-tessa-bg" x1="160" y1="24" x2="160" y2="500" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#18d4c9" stop-opacity="0.34"/>
            <stop offset="100%" stop-color="#0f1722" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="shard-port-tessa-armor" x1="80" y1="150" x2="240" y2="504" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#263845"/>
            <stop offset="100%" stop-color="#121c26"/>
          </linearGradient>
        </defs>
        <polygon points="160,24 282,96 282,360 160,496 38,360 38,96" fill="url(#shard-port-tessa-bg)" stroke="#18d4c9" stroke-width="1.6" stroke-opacity="0.35"/>
        <!-- Articulated bastion pauldrons & sentinel armor -->
        <polygon points="56,220 116,180 204,180 264,220 242,504 78,504" fill="url(#shard-port-tessa-armor)" stroke="#18d4c9" stroke-width="2.4"/>
        <polygon points="44,208 106,174 114,248 54,268" fill="#1f313d" stroke="#18d4c9" stroke-width="2.4"/>
        <polygon points="276,208 214,174 206,248 266,268" fill="#1f313d" stroke="#18d4c9" stroke-width="2.4"/>
        <!-- Hexagonal bastion core crest -->
        <polygon points="160,228 196,248 196,292 160,314 124,292 124,248" fill="#18d4c9" fill-opacity="0.22" stroke="#18d4c9" stroke-width="2.6"/>
        <polygon points="160,248 178,258 178,282 160,292 142,282 142,258" fill="#18d4c9"/>
        <!-- Geometric crest visor & sculpted helm -->
        <polygon points="122,82 160,58 198,82 202,146 160,176 118,146" fill="#2c3d4c" stroke="#e2edf5" stroke-width="2"/>
        <polygon points="126,108 160,96 194,108 188,128 160,120 132,128" fill="#18d4c9"/>
      </svg>`;
  }
}
