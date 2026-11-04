import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { localIdentityAdmin } from "./marketplace/keycloak-admin";
const call=await localIdentityAdmin();
const suffix=randomBytes(5).toString("hex");
const identities:Record<string,{email:string;password:string;id:string}>={};
for(const role of ["buyer","licensor","staff","stranger"]){
 const email=`${role}-${suffix}@example.invalid`,password=randomBytes(24).toString("base64url");
 await call("/users","POST",{username:email,email,emailVerified:true,enabled:true,firstName:"Local",lastName:role,credentials:[{type:"password",value:password,temporary:false}],requiredActions:role==="staff"?["CONFIGURE_TOTP"]:[]});
 const user=(await call(`/users?email=${encodeURIComponent(email)}&exact=true`))[0];
 if(role!=="buyer"&&role!=="stranger"){
  const definition=await call(`/roles/${role}`);
  await call(`/users/${user.id}/role-mappings/realm`,"POST",[definition]);
 }
 identities[role]={email,password,id:user.id};
}
await mkdir(".data-private-tests",{recursive:true,mode:0o700});
await writeFile(".data-private-tests/identities.json",JSON.stringify(identities),{mode:0o600});
console.log("Created local-only identity fixtures in ignored test storage.");
