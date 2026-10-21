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
