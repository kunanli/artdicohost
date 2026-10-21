const messages={403:'此账号没有管理设置的权限。',409:'设置已由其他操作更新，请保留本页内容并重新核对。',422:'设置内容未通过检查，请核对字段。',429:'请求较多，请稍后重试。',503:'设置服务暂时不可用，请稍后重新读取。'};
const stale=()=>new Error('会话已改变，请重新读取当前设置。');

/** A settings request is tied to the session that started it, including JSON
 * decoding. An old 401 must never log out a subsequently authenticated account. */
export function createSettingsSession({fetchFn=globalThis.fetch,onExpired=()=>{},onForbidden=()=>{}}={}){
  let generation=0,csrfToken='';
  const clear=()=>{generation++;csrfToken='';};
  const current=stamp=>{if(stamp!==generation)throw stale();};
  async function request(path,options={}){
    if(typeof path!=='string'||!/^\/api\/admin\/[A-Za-z0-9/_-]+$/u.test(path))throw new Error('设置请求路径无效。');
    const {binary=false,...fetchOptions}=options,stamp=generation,method=options.method??'GET';
    const response=await fetchFn(path,{...fetchOptions,method,credentials:'same-origin',cache:'no-store',redirect:'error',
      headers:{Accept:binary?'application/octet-stream':'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(method!=='GET'&&csrfToken?{'X-CSRF-Token':csrfToken}:{})}});
    current(stamp);
    if(response.status===401){clear();onExpired(path);throw new Error(path==='/api/admin/login'?'账号或密码未通过验证。':'会话已结束，请重新登录。');}
    if(response.status===403){clear();onForbidden();throw new Error(messages[403]);}
    if(!response.ok){const error=new Error(messages[response.status]??'操作尚未确认完成，请稍后核对。');error.status=response.status;throw error;}
    if(binary)return response;
    if(!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type')??''))throw new Error('设置状态格式无效，请重新读取。');
    const result=await response.json().catch(()=>null);current(stamp);
    if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('设置状态未通过核对，请重新读取。');
    return result;
  }
  return Object.freeze({request,clear,get generation(){return generation;},
    setSession(session){
      if(!session?.user||typeof session.user.id!=='string'||!session.user.id||!Array.isArray(session.user.roles)
        ||session.user.roles.some(role=>typeof role!=='string')||typeof session.csrfToken!=='string'||!/^[A-Za-z0-9_-]{43}$/u.test(session.csrfToken))throw new Error('工作人员会话未通过核对。');
      generation++;csrfToken=session.csrfToken;return session.user;
    },
  });
}
