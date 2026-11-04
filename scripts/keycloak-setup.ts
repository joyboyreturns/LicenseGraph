import { readFile } from "node:fs/promises";
import { localIdentityAdmin } from "./marketplace/keycloak-admin";
const call=await localIdentityAdmin();
const realm=JSON.parse(await readFile("infra/keycloak/licensegraph-realm.json","utf8"));
const clients=await call("/clients?clientId=licensegraph");
if(!clients[0])throw new Error("Import the local realm first.");
const client=clients[0];
for(const mapper of realm.clients[0].protocolMappers){
 const existing=(await call(`/clients/${client.id}/protocol-mappers/models`)).find((m:{name:string})=>m.name===mapper.name);
 if(!existing)await call(`/clients/${client.id}/protocol-mappers/models`,"POST",mapper);
}
const flows=await call("/authentication/flows");
if(!flows.some((f:{alias:string})=>f.alias==="workspace-browser")){
 await call("/authentication/flows","POST",{alias:"workspace-browser",providerId:"basic-flow",topLevel:true,builtIn:false});
 await call("/authentication/flows/workspace-browser/executions/execution","POST",{provider:"auth-username-password-form"});
 await call("/authentication/flows/workspace-browser/executions/flow","POST",{alias:"workspace-conditional-otp",type:"basic-flow",provider:"basic-flow"});
 await call("/authentication/flows/workspace-conditional-otp/executions/execution","POST",{provider:"conditional-user-configured"});
 await call("/authentication/flows/workspace-conditional-otp/executions/execution","POST",{provider:"auth-otp-form"});
 const executions=await call("/authentication/flows/workspace-browser/executions");
 for(const execution of executions){
  const requirement=execution.authenticationFlow?"CONDITIONAL":"REQUIRED";
  await call("/authentication/flows/workspace-browser/executions","PUT",{...execution,requirement});
  if(execution.providerId==="auth-otp-form")await call(`/authentication/executions/${execution.id}/config`,"POST",{alias:"workspace-otp-amr",config:{"default.reference.value":"otp","default.reference.maxAge":"3600"}});
 }
}
await call("","PUT",{browserFlow:"workspace-browser"});
console.log("Local identity sign-in and MFA claim mapping configured.");
