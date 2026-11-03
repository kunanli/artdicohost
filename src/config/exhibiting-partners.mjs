/** Public organization names confirmed by the event organizer; their participation types are not inferred. */
export const exhibitingPartners = [
  { id: 'g4c-hk', name: 'G4C HK' },
  { id: 'pengyou-gangwan', name: '鹏游港湾' },
  { id: 'game-singularity', name: '游戏奇点' },
  { id: 'igda-shenzhen', name: 'IGDA 深圳' },
];

/** Fresh editable fallback for an older content draft, materialized only by an explicit organization edit. */
export function createDefaultOrganizations() {
  return exhibitingPartners.map(({id,name}) => ({
    id,name,logoId:'',website:'',participation:'undecided',status:'confirmed',publicConsent:true,internalNotes:'',
  }));
}

export const ORGANIZATIONS_PER_PAGE = 8;

// Layout follows array order, not brand identity. Every row is symmetric about
// the sphere centre; even the last page remains a complete centred composition.
const desktopRows = [[], [[1,50,50,22]], [[2,50,30,20]], [[3,50,24,18]],
  [[2,34,30,18],[2,66,30,18]], [[2,25,27,16],[1,50,40,16],[2,75,27,16]],
  [[3,35,24,18],[3,65,24,18]], [[2,25,27,16],[3,50,24,16],[2,75,27,16]],
  [[2,25,27,16],[4,50,18.5,16],[2,75,27,16]]];
const mobileRows = [[], [[1,50,60,20]], [[2,50,34,16]], [[1,25,52,16],[1,50,52,16],[1,75,52,16]],
  [[2,32,34,16],[2,68,34,16]], [[2,28,34,16],[1,50,40,16],[2,72,34,16]],
  [[2,28,34,16],[2,50,34,16],[2,72,34,16]],
  [[1,15,40,16],[2,32.5,34,16],[1,50,40,16],[2,67.5,34,16],[1,85,40,16]],
  [[1,15,40,16],[2,32.5,34,16],[2,50,34,16],[2,67.5,34,16],[1,85,40,16]]];

export function organizationLayout(count, { mobile = false } = {}) {
  if (!Number.isSafeInteger(count) || count < 0 || count > ORGANIZATIONS_PER_PAGE || typeof mobile !== 'boolean') throw new TypeError('Invalid organization layout.');
  return (mobile ? mobileRows : desktopRows)[count].flatMap(([columns,y,width,height]) => {
    const centres = columns === 1 ? [50] : columns === 2 ? (mobile ? [31,69] : [34,66])
      : columns === 3 ? [22,50,78] : [18.5,39.5,60.5,81.5];
    return centres.map(x => ({ x, y, width, height }));
  });
}
