import { registrationSchema } from './registration-schema.mjs';

// Public choices are a presentation projection. Historical registration values
// and their validation remain in the original contract for existing records.
const excludedOptions = new Set(['sponsor', 'sponsorship', 'funding']);
/** @type {Record<string, string>} */
const optionLabels = {
  partner: '社群伙伴', partnership: '社群交流', site_support: '站点筹备咨询',
  promotion: '社群活动推广', tools: '技术与工具交流', mentoring: '导师交流',
};
/** @type {Record<string, Partial<import('./registration-schema.mjs').Field>>} */
const fieldLabels = {
  participationInterests: { label: '参与方式', hint: '普通参会可选「仅出席」。讲者、展位与站点咨询另行沟通。' },
  topics: { label: '希望交流的议题、经验或项目' },
  cooperationInterest: { label: '是否有兴趣参与 GGJ 社群交流' },
  cooperationForms: { label: '感兴趣的交流形式', hint: '选填，具体交流安排另行沟通。' },
};
/** @type {Record<string, Partial<import('./registration-schema.mjs').Field>>} */
const partnerFieldLabels = {
  direction: { label: '希望交流的方向' },
  resources: { label: '可分享的经验或工具', hint: '选填，可介绍组织经验、工具或社群活动。' },
};

/** @param {import('./registration-schema.mjs').Option[]} options */
const projectOptions = options => options.filter(option => !excludedOptions.has(option.value))
  .map(option => ({ ...option, label: optionLabels[option.value] ?? option.label }));

/**
 * @param {import('./registration-schema.mjs').Field} field
 * @param {Partial<import('./registration-schema.mjs').Field>} [labels]
 */
const projectField = (field, labels = {}) => ({
  ...field,
  ...(field.options ? { options: projectOptions(field.options) } : {}),
  ...labels,
});

export const publicRegistrationSchema = Object.freeze({
  ...registrationSchema,
  identityOptions: projectOptions(registrationSchema.identityOptions),
  participationOptions: projectOptions(registrationSchema.participationOptions),
  baseFields: registrationSchema.baseFields.map(field => projectField(field, fieldLabels[field.name])),
  branches: Object.fromEntries(Object.entries(registrationSchema.branches).map(([name, branch]) => [name, {
    ...branch,
    label: name === 'partner' ? '社群交流（另行沟通）' : branch.label,
    fields: branch.fields.map(field => projectField(field, name === 'partner' ? partnerFieldLabels[field.name] : undefined)),
  }])),
  inquiryNotice: '讲者、展位、站点咨询与住宿申请分别沟通。预览不发送或保存报名资料。',
});

/** One short application; identity does not require legacy questionnaire branches. */
export const generalApplicationSchema = Object.freeze({
  fields: [
    {name:'name',label:'姓名',type:'text',required:true,minLength:2,maxLength:80},
    {name:'email',label:'Email',type:'email',required:true,maxLength:254,hint:'用于查询申请及接收审核后的通知。'},
    {name:'categories',label:'参与身份',type:'select',required:true,options:projectOptions(registrationSchema.identityOptions)},
    {name:'organization',label:'学校／机构／团队',type:'text',required:false,maxLength:160},
    {name:'city',label:'所在城市',type:'text',required:false,maxLength:100},
    {name:'wechat',label:'微信号',type:'text',required:false,maxLength:100},
    {name:'consentAccepted',label:'我已阅读说明，并了解预览不会提交真实资料',type:'checkbox',required:true,hint:'正式申请须由你主动阅读并同意个人信息处理告知。'},
  ],
  proposal: [
    {name:'topic',label:'拟分享主题',type:'text',required:true,maxLength:200},
    {name:'summary',label:'主题简介',type:'textarea',required:true,maxLength:1500},
  ],
});

const recruitmentChoices = {
  speaker: { categories: [], participationInterests: ['talk'] },
  site: { categories: ['new_site'], participationInterests: ['attend'] },
  student: { categories: ['student'], participationInterests: ['attend'] },
};

/** Unknown CTA names cannot select an unrelated identity or interest.
 * @param {unknown} kind
 * @returns {{categories:string[], participationInterests:string[]} | null}
 */
export function getRecruitmentChoices(kind) {
  if (typeof kind !== 'string' || !Object.hasOwn(recruitmentChoices, kind)) return null;
  const choices = recruitmentChoices[/** @type {keyof typeof recruitmentChoices} */ (kind)];
  return { categories: [...choices.categories], participationInterests: [...choices.participationInterests] };
}
