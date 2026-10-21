/** User-approved event decisions. Contact identity is supplied by protected repository configuration. */
export function approvedRegistrationPolicy({ contactEmail, enabled = true } = {}) {
  if (typeof contactEmail !== 'string' || !/^[^\s@<>]+@artdico\.co$/iu.test(contactEmail)) throw new Error('The approved event privacy contact is not configured.');
  return {
    enabled: enabled === true,
    eventId: 'ggj-cn-2026',
    opensAt: '2026-10-20T00:00:00+08:00',
    closesAt: '2026-12-05T12:00:00+08:00',
    capacity: 300,
    privacy: {
      version: 'artdico-registration-2026-10-20-v1',
      processor: 'ARTDiCO HOST 活动筹备团队',
      contactEmail: contactEmail.trim().toLowerCase(),
      purpose: '用于本次活动报名、身份与意向核对、联系、邀请、场次及住宿安排；住宿、讲者与展位分别人工确认。',
      storageRegion: '中国香港的独立私有 OSS 存储',
      retention: '保留至 2027 年 3 月 5 日；届期由受控维护流程删除或匿名化，申请处理及依法需要保留的记录分别核对。',
      rightsRequest: '可通过上述邮箱申请查阅、更正、撤回与删除；工作人员核对后记录处理结果。撤回不影响撤回前的有效处理。',
      sharing: '不自动公开联系方式、住宿或内部备注，不自动向 Maria 或其他第三方发送全量资料；必要的额外分享另行核对告知与授权。',
    },
  };
}

/** Initial admissions policy only; a saved private index setting takes precedence. */
export function approvedAdmissionDefaults({ enabled = true } = {}) {
  return Object.freeze({ staffReserve: 0, waitlistEnabled: enabled === true });
}
