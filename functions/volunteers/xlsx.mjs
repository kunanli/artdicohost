import { createXlsxWorkbook } from '../../shared/xlsx-workbook.mjs';

const workflow = { pending: '待联系', invited: '已邀请', confirmed: '已确认', declined: '已婉拒', inactive: '暂停参与' };
const admission = { confirmed: '参会已确认', waitlisted: '候补', withdrawn: '已撤回', unlinked: '未关联报名', unavailable: '暂不可核实' };
const assignment = { proposed: '拟安排', confirmed: '已确认', cancelled: '已取消' };
const cell = value => value === null || value === undefined ? '' : String(value);
const windows = value => value.map(item => item.start + '–' + item.end).join('；');

/** Deterministic, selected-person-only workbook. Contact columns require explicit opt-in. */
export function volunteerWorkbook({ view, volunteerIds, includeContact }) {
  const selected = new Set(volunteerIds), people = view.volunteers.filter(row => selected.has(row.id)).sort((a, b) => a.id.localeCompare(b.id));
  const peopleById = new Map(people.map(row => [row.id, row])), shifts = new Map(view.shifts.map(row => [row.id, row]));
  const positions = new Map(view.positions.map(row => [row.id, row]));
  const allocated = view.assignments.filter(row => selected.has(row.volunteerId)).sort((a, b) => a.id.localeCompare(b.id));
  const relevantShiftIds = new Set(allocated.map(row => row.shiftId));
  const rosterHeaders = ['志愿者编号', '来源类别', '来源编号', '姓名', '组织', '沟通状态', '参会状态', '负责同事', '下次跟进日期', '最近联系日期', '可参与时间', '需处理事项'];
  if (includeContact) rosterHeaders.push('邮箱', '微信', '电话');
  const rosterRows = people.map(row => {
    const cells = [row.id, row.source.kind, row.source.id, row.person.name, row.person.organization, workflow[row.workflowStatus], admission[row.person.admissionStatus], row.owner,
      row.followUpAt, row.lastContactAt, windows(row.availability), [...new Set([...row.issues, ...row.person.issues])].join('；')];
    if (includeContact) cells.push(row.person.email, row.person.wechat, row.person.phone);
    return cells.map(cell);
  });
  return createXlsxWorkbook([
    { name: '志愿者名册', headers: rosterHeaders, rows: rosterRows },
    { name: '所选人员安排', headers: ['安排编号', '志愿者编号', '姓名', '岗位', '区域', '地点', '开始', '结束', '安排状态', '当前有效', '需处理事项'], rows: allocated.map(row => {
      const shift = shifts.get(row.shiftId), position = positions.get(shift?.positionId), person = peopleById.get(row.volunteerId);
      return [row.id, row.volunteerId, person.person.name, position?.name, position?.zone, position?.location, shift?.start, shift?.end, assignment[row.status], row.valid ? '是' : '否', row.issues.join('；')].map(cell);
    }) },
    { name: '相关班次缺口', headers: ['班次编号', '岗位', '区域', '地点', '开始', '结束', '需求人次', '拟安排人次', '有效确认人次', '缺口人次', '班次状态', '需处理事项'], rows: view.shifts.filter(row => relevantShiftIds.has(row.id)).sort((a, b) => a.id.localeCompare(b.id)).map(row => {
      const position = positions.get(row.positionId);
      return [row.id, position?.name, position?.zone, position?.location, row.start, row.end, row.required, row.proposedCount, row.confirmedCount, row.gap, row.status === 'active' ? '开放' : '已取消', row.issues.join('；')].map(cell);
    }) },
    { name: '导出范围', headers: ['项目', '值'], rows: [
      ['活动', view.event.title], ['活动编号', view.event.id], ['活动日期', view.event.date], ['时区', view.event.timezone], ['所选人员数', people.length], ['含联络资料', includeContact ? '是' : '否'],
      ['说明', '只导出明确所选人员；相关班次人次统计反映该班次全部有效安排，不等于所选人数。私密沟通备注不导出。'],
      ...Object.entries(view.revisions).map(([key, value]) => ['来源修订 ' + key, value]),
    ].map(row => row.map(cell)) },
  ]);
}
