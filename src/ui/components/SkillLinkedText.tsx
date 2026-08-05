import type { ReactNode } from 'react';
import type { SkillIndex } from '../../api/gw2.ts';
import type { InferredBuild, ReferenceBuild } from '../../model/build.ts';
import { splitGw2Names } from '../linkGw2Names.ts';
import { skillKeybind } from '../skillKeybind.ts';
import { Gw2NameChip, SkillTipContent, TraitTipContent } from './Gw2Tip.tsx';
import { HoverTooltip } from './HoverTooltip.tsx';

function utilityKeybind(
  skillId: number | undefined,
  skillName: string,
  build?: InferredBuild,
  reference?: ReferenceBuild,
): string | undefined {
  for (const utilities of [build?.utilities, reference?.utilities]) {
    if (!utilities) continue;
    const index = utilities.findIndex(
      (entry) => (skillId !== undefined && entry.id === skillId) || entry.name === skillName,
    );
    if (index >= 0) return skillKeybind('Utility', index);
  }
  return undefined;
}

function LinkedChip({
  content,
  chip,
}: {
  content: ReactNode;
  chip: ReactNode;
}) {
  return (
    <HoverTooltip content={content} className="mx-0.5 inline-flex align-middle">
      {chip}
    </HoverTooltip>
  );
}

interface Props {
  text: string;
  skills?: SkillIndex;
  build?: InferredBuild;
  reference?: ReferenceBuild;
}

/** Renders prose with skill/trait names as the same icon + keybind chips used in the build panel. */
export function SkillLinkedText({ text, skills, build, reference }: Props) {
  const parts = splitGw2Names(text, skills);

  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === 'text') return <span key={index}>{part.value}</span>;

        if (part.kind === 'trait') {
          const specialization =
            part.trait.specialization !== undefined
              ? skills?.specialization(part.trait.specialization)?.name
              : undefined;
          return (
            <LinkedChip
              key={index}
              content={<TraitTipContent trait={part.trait} specialization={specialization} />}
              chip={<Gw2NameChip name={part.name} icon={part.trait.icon} />}
            />
          );
        }

        const keybind =
          part.skill.slot === 'Utility'
            ? utilityKeybind(part.skill.id, part.skill.name, build, reference)
            : skillKeybind(part.skill.slot);
        const chain = skills?.chainPosition(part.skill.id);

        return (
          <LinkedChip
            key={index}
            content={<SkillTipContent skill={part.skill} keybind={keybind} chain={chain} />}
            chip={<Gw2NameChip name={part.name} icon={part.skill.icon} keybind={keybind} />}
          />
        );
      })}
    </>
  );
}
