import type { SkillIndex } from '../api/gw2.ts';
import type { BuildSkillRef, BuildTraitRef, ReferenceBuild, ReferenceSpecialization } from './build.ts';
import { weaponSkillsFromWeapons } from './build.ts';

export class ChatCodeError extends Error {}

/** Build template links are chat link type 0x0D. */
const BUILD_TEMPLATE_TYPE = 0x0d;

const PROFESSION_NAMES: Record<number, string> = {
  1: 'Guardian',
  2: 'Warrior',
  3: 'Engineer',
  4: 'Ranger',
  5: 'Thief',
  6: 'Elementalist',
  7: 'Mesmer',
  8: 'Necromancer',
  9: 'Revenant',
};

export interface DecodedSpecialization {
  id: number;
  /**
   * Chosen major trait per tier, as a 0-based position (0 top, 1 middle,
   * 2 bottom). -1 means no trait was selected for that tier.
   */
  choices: [number, number, number];
}

export interface DecodedBuildTemplate {
  professionId: number;
  professionName: string;
  specializations: DecodedSpecialization[];
  /** Skill palette ids for the terrestrial bar. */
  palettes: {
    heal: number;
    utilities: [number, number, number];
    elite: number;
  };
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Decodes a build template chat link such as `[&DQcBHRgaQiojDyMP...]`.
 *
 * Layout: type byte, profession byte, three (specialization id, packed trait
 * choices) pairs, then ten little-endian uint16 skill palette ids covering the
 * terrestrial and aquatic bars. Trailing bytes hold profession-specific and
 * newer weapon data, which this decoder ignores.
 */
export function decodeBuildChatCode(input: string): DecodedBuildTemplate {
  const trimmed = input.trim().replace(/^\[&/, '').replace(/\]$/, '').replace(/\s+/g, '');
  if (!trimmed) throw new ChatCodeError('The chat code was empty.');

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(trimmed);
  } catch {
    throw new ChatCodeError('That does not look like a chat code. Copy the whole thing, including the [& and ].');
  }

  if (bytes.length < 28) {
    throw new ChatCodeError('That chat code is too short to be a build template.');
  }
  if (bytes[0] !== BUILD_TEMPLATE_TYPE) {
    throw new ChatCodeError(
      'That is a chat code, but not a build template. Use the code from the Build Template panel in game.',
    );
  }

  const professionId = bytes[1];
  const professionName = PROFESSION_NAMES[professionId];
  if (!professionName) throw new ChatCodeError(`Unknown profession id ${professionId} in that chat code.`);

  const specializations: DecodedSpecialization[] = [];
  for (let i = 0; i < 3; i += 1) {
    const id = bytes[2 + i * 2];
    const packed = bytes[3 + i * 2];
    if (id === 0) continue;
    specializations.push({
      id,
      // Two bits per tier, stored as 1-3 for top/middle/bottom.
      choices: [(packed & 0b11) - 1, ((packed >> 2) & 0b11) - 1, ((packed >> 4) & 0b11) - 1],
    });
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const palette = (index: number) => view.getUint16(8 + index * 2, true);

  return {
    professionId,
    professionName,
    specializations,
    palettes: {
      // Aquatic variants sit at the odd indices and are not used here.
      heal: palette(0),
      utilities: [palette(2), palette(4), palette(6)],
      elite: palette(8),
    },
  };
}

function paletteToSkillRef(palette: number, skills: SkillIndex | undefined): BuildSkillRef | undefined {
  if (!palette) return undefined;
  const skill = skills?.skillForPalette(palette);
  if (!skill) return undefined;
  return { id: skill.id, name: skill.name, slot: skill.slot, icon: skill.icon };
}

/** Turns a decoded template into a reference build using the GW2 API snapshot. */
export function referenceBuildFromChatCode(
  code: string,
  skills: SkillIndex | undefined,
  meta: { name: string; url?: string; source?: ReferenceBuild['source']; weapons?: string[]; attribution?: string } = {
    name: 'Pasted build template',
  },
): ReferenceBuild {
  const decoded = decodeBuildChatCode(code);

  const specializations: ReferenceSpecialization[] = decoded.specializations.map((spec) => {
    const info = skills?.specialization(spec.id);
    const traits: BuildTraitRef[] = [];
    spec.choices.forEach((position, tier) => {
      if (position < 0) return;
      const trait = skills?.majorTrait(spec.id, tier, position);
      if (!trait) return;
      traits.push({
        id: trait.id,
        name: trait.name,
        icon: trait.icon,
        tier: trait.tier,
        specialization: info?.name,
        evidence: 'chat-code',
      });
    });
    return { id: spec.id, name: info?.name ?? `Specialization ${spec.id}`, traits };
  });

  const eliteSpec = specializations.find((spec) => skills?.specialization(spec.id ?? -1)?.elite)?.name;

  return {
    name: meta.name,
    source: meta.source ?? 'chat-code',
    url: meta.url,
    profession: decoded.professionName,
    eliteSpec,
    weapons: meta.weapons ?? [],
    weaponSkills: weaponSkillsFromWeapons(meta.weapons ?? [], skills),
    heal: paletteToSkillRef(decoded.palettes.heal, skills),
    utilities: decoded.palettes.utilities
      .map((palette) => paletteToSkillRef(palette, skills))
      .filter((skill): skill is BuildSkillRef => !!skill),
    elite: paletteToSkillRef(decoded.palettes.elite, skills),
    specializations,
    chatCode: code.trim(),
    attribution: meta.attribution,
  };
}
