import type { ModulePack } from '../types.js';

/**
 * Original sample adventure authored for Eshyra, licensed CC-BY-4.0. It
 * exists to exercise the module schema, campaign fork, and `worldQuery`
 * without depending on any third-party adventure (that conversion is gated on
 * a confirmed legal source — see beads loreweaver-9s6). Creatures reference
 * rules records by provider-neutral `rulesRef`, resolved through the
 * campaign's rules binding (default D&D 5e SRD).
 */
export const EMBERFALL_HOLLOW: ModulePack = {
  meta: {
    packId: 'eshyra:emberfall-hollow',
    title: 'The Hollow Beneath Emberfall',
    packType: 'adventure',
    description:
      'A short cave-delve adventure: the village of Emberfall asks a wanderer to find out why goblins crept back into the hollow under the old watchtower.',
    startingLocationId: 'emberfall-square',
    rulesRequirements: {
      baseSystemId: 'dnd5e-srd',
    },
    license: {
      licenseClass: 'original',
      licenseName: 'Creative Commons Attribution 4.0 International',
      attributionText:
        'The Hollow Beneath Emberfall, original work for Eshyra, released under CC-BY-4.0.',
      requiresAttribution: true,
      commercialUseAllowed: true,
      hostedUseAllowed: true,
      redistributionAllowed: true,
      publicSharingAllowed: true,
      derivativeAllowed: true,
      containsUserSuppliedText: false,
      containsTrademarkedSettingMaterial: false,
      sourceMaterialDescription:
        'Wholly original prose and structure; creature stat blocks are referenced from SRD 5.1 (CC-BY-4.0), not copied here.',
      provenancePolicy:
        'Authored in-repo; no third-party adventure text incorporated.',
      outputRestrictions: 'None beyond CC-BY-4.0 attribution.',
    },
  },
  locations: [
    {
      id: 'emberfall-square',
      name: 'Emberfall Square',
      summary: 'A small village square ringed by soot-streaked houses.',
      description:
        'Smoke still hangs over Emberfall from last week. The well at the center is dry, and villagers eye the dark hill where the old watchtower leans.',
      exits: [{ direction: 'north', toLocationId: 'watchtower-mouth' }],
      encounterIds: [],
      npcIds: ['warden-sela'],
      tags: ['safe', 'hub'],
    },
    {
      id: 'watchtower-mouth',
      name: 'The Watchtower Mouth',
      summary: 'A collapsed tower base opening into a black hollow.',
      description:
        'The watchtower has half-fallen into the hill, leaving a jagged opening. Cold air and the smell of wet stone breathe out of the dark.',
      exits: [
        { direction: 'south', toLocationId: 'emberfall-square' },
        { direction: 'down', toLocationId: 'hollow-deep' },
      ],
      encounterIds: ['goblin-ambush'],
      npcIds: [],
      tags: ['threshold'],
    },
    {
      id: 'hollow-deep',
      name: 'The Deep Hollow',
      summary: 'A wide cavern where the goblins have made a camp.',
      description:
        'Crude bone-charms hang from the cavern roof. A cookfire smokes against the far wall beside a stack of stolen Emberfall grain.',
      exits: [{ direction: 'up', toLocationId: 'watchtower-mouth' }],
      encounterIds: [],
      npcIds: [],
      tags: ['objective'],
    },
  ],
  encounters: [
    {
      id: 'goblin-ambush',
      name: 'Ambush at the Mouth',
      description:
        'Two goblins watching the tower mouth loose arrows from the rubble before closing to knife range.',
      locationId: 'watchtower-mouth',
      creatures: [{ rulesRef: 'creature:goblin', count: 2, role: 'sentry' }],
      reward: 'A bent iron key that opens the grain cache below.',
    },
  ],
  npcs: [
    {
      id: 'warden-sela',
      name: 'Warden Sela',
      role: 'Village warden',
      locationId: 'emberfall-square',
      disposition: 'wary but grateful',
      summary:
        'A tired militia warden who lost two scouts to the hollow and will not enter it herself.',
      secret:
        'Sela ordered the watchtower abandoned years ago; the goblins moved in because of her decision, and she fears the village learning this.',
    },
  ],
  triggers: [
    {
      id: 'cleared-the-hollow',
      when: 'The goblin-ambush encounter is resolved and the deep hollow is reached.',
      effect:
        'Emberfall reopens the well road; Warden Sela offers the watchtower as a base.',
      once: true,
    },
  ],
  lore: [
    {
      id: 'why-emberfall-burned',
      title: 'Why Emberfall Burned',
      text: 'Emberfall takes its name from a forge-fire that escaped its banks a generation ago. The village rebuilt downhill of the old watchtower.',
      scope: 'public',
    },
    {
      id: 'the-hollow-truth',
      title: 'What Lives Below',
      text: 'The hollow is not a goblin lair by nature — it is a forgotten cellar of the watchtower, and something older than goblins sealed its lowest door.',
      scope: 'dm',
    },
  ],
};
