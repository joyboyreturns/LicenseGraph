/** Local identity configuration only. Never targets an external identity installation. */
export async function localIdentityAdmin() {
 const origin="http://localhost:8081";
 if(!process.env.LOCAL_IDENTITY_ADMIN_PASSWORD)throw new Error("Local identity admin configuration is missing.");
 const response=await fetch(`${origin}/realms/master/protocol/openid-connect/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"password",client_id:"admin-cli",username:"administrator",password:process.env.LOCAL_IDENTITY_ADMIN_PASSWORD})});
 if(!response.ok)throw new Error(`Local identity sign-in failed (${response.status}).`);
 const token=await response.json() as {access_token:string};
 return async function call(path:string,method="GET",body?:unknown){
  const res=await fetch(`${origin}/admin/realms/licensegraph${path}`,{method,headers:{Authorization:`Bearer ${token.access_token}`,"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  if(!res.ok)throw new Error(`Local identity configuration failed at ${path} (${res.status}).`);
  return res.status===204?null:await res.json().catch(()=>null);
 };
}
