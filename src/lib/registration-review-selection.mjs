/** Registration IDs are 43-character base64url, including a leading '-' or '_'. */
export function reviewRegistrationSelection(hash) {
  if(typeof hash!=='string'||hash.length>256||!hash.startsWith('#registration='))return null;
  try{const id=decodeURIComponent(hash.slice(14));return /^[A-Za-z0-9_-]{43}$/u.test(id)?id:null;}catch{return null;}
}
