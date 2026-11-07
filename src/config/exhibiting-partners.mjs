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

// Layout follows array order, not brand identity. Every row is symmetric about
// the sphere centre; all organizations stay in one complete composition.
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
  if (!Number.isSafeInteger(count) || count < 0 || count > 200 || typeof mobile !== 'boolean') throw new TypeError('Invalid organization layout.');
  if (mobile && count > 8 && count <= 16) {
    const rows = {9:[1,2,3,2,1],10:[1,3,2,3,1],11:[2,2,3,2,2],12:[2,3,2,3,2],13:[2,3,3,3,2],14:[2,3,4,3,2],15:[2,3,5,3,2],16:[2,4,4,4,2]}[count];
    return rows.flatMap((size,row)=>Array.from({length:size},(_,column)=>({x:50+(column-(size-1)/2)*18,y:14+row*18,width:17,height:17})));
  }
  if (count > 8) {
    // Fit every published organization into one centred composition.
    const rows = Math.max(3, 2 * Math.floor(Math.sqrt(count) / 2) + 1);
    const sizes = Array(rows).fill(Math.floor(count / rows));
    let extra = count % rows;
    if (extra % 2) { sizes[(rows - 1) / 2]++; extra--; }
    for (let distance = 1; extra > 0; distance++, extra -= 2) {
      sizes[(rows - 1) / 2 - distance]++; sizes[(rows - 1) / 2 + distance]++;
    }
    const step = 64 / Math.max(...sizes, rows), width = step * .82, height = step * .68;
    return sizes.flatMap((size, row) => Array.from({length: size}, (_, column) => ({
      x: 50 + (column - (size - 1) / 2) * step,
      y: 50 + (row - (rows - 1) / 2) * step, width, height,
    })));
  }
  return (mobile ? mobileRows : desktopRows)[count].flatMap(([columns,y,width,height]) => {
    const centres = columns === 1 ? [50] : columns === 2 ? (mobile ? [31,69] : [34,66])
      : columns === 3 ? [22,50,78] : [18.5,39.5,60.5,81.5];
    return centres.map(x => ({ x, y, width, height }));
  });
}
