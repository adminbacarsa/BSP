"use strict";(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[2806],{22806:function(e,t,n){n.d(t,{deleteToken:function(){return deleteToken},getMessaging:function(){return getMessagingInWindow},getToken:function(){return index_esm_getToken},onMessage:function(){return onMessage}});var a,i,r,o,s=n(33310),u=n(75),c=n(99711),l=n(26531);let d="@firebase/installations",g="0.6.19",p=`w:${g}`,f="FIS_v2",w=new c.LL("installations","Installations",{"missing-app-config-values":'Missing App configuration value: "{$valueName}"',"not-registered":"Firebase Installation is not registered.","installation-not-found":"Firebase Installation not found.","request-failed":'{$requestName} request failed with error "{$serverCode} {$serverStatus}: {$serverMessage}"',"app-offline":"Could not process request. Application offline.","delete-pending-registration":"Can't delete installation while there is a pending registration request."});function isServerError(e){return e instanceof c.ZR&&e.code.includes("request-failed")}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function getInstallationsEndpoint({projectId:e}){return`https://firebaseinstallations.googleapis.com/v1/projects/${e}/installations`}function extractAuthTokenInfoFromResponse(e){return{token:e.token,requestStatus:2,expiresIn:getExpiresInFromResponseExpiresIn(e.expiresIn),creationTime:Date.now()}}async function getErrorFromResponse(e,t){let n=await t.json(),a=n.error;return w.create("request-failed",{requestName:e,serverCode:a.code,serverMessage:a.message,serverStatus:a.status})}function getHeaders({apiKey:e}){return new Headers({"Content-Type":"application/json",Accept:"application/json","x-goog-api-key":e})}function getHeadersWithAuth(e,{refreshToken:t}){let n=getHeaders(e);return n.append("Authorization",getAuthorizationHeader(t)),n}async function retryIfServerError(e){let t=await e();return t.status>=500&&t.status<600?e():t}function getExpiresInFromResponseExpiresIn(e){return Number(e.replace("s","000"))}function getAuthorizationHeader(e){return`${f} ${e}`}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function createInstallationRequest({appConfig:e,heartbeatServiceProvider:t},{fid:n}){let a=getInstallationsEndpoint(e),i=getHeaders(e),r=t.getImmediate({optional:!0});if(r){let e=await r.getHeartbeatsHeader();e&&i.append("x-firebase-client",e)}let o={fid:n,authVersion:f,appId:e.appId,sdkVersion:p},s={method:"POST",headers:i,body:JSON.stringify(o)},u=await retryIfServerError(()=>fetch(a,s));if(u.ok){let e=await u.json(),t={fid:e.fid||n,registrationStatus:2,refreshToken:e.refreshToken,authToken:extractAuthTokenInfoFromResponse(e.authToken)};return t}throw await getErrorFromResponse("Create Installation",u)}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function sleep(e){return new Promise(t=>{setTimeout(t,e)})}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function bufferToBase64UrlSafe(e){let t=btoa(String.fromCharCode(...e));return t.replace(/\+/g,"-").replace(/\//g,"_")}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */let h=/^[cdef][\w-]{21}$/;function generateFid(){try{let e=new Uint8Array(17),t=self.crypto||self.msCrypto;t.getRandomValues(e),e[0]=112+e[0]%16;let n=encode(e);return h.test(n)?n:""}catch{return""}}function encode(e){let t=bufferToBase64UrlSafe(e);return t.substr(0,22)}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function getKey(e){return`${e.appName}!${e.appId}`}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */let m=new Map;function fidChanged(e,t){let n=getKey(e);callFidChangeCallbacks(n,t),broadcastFidChange(n,t)}function callFidChangeCallbacks(e,t){let n=m.get(e);if(n)for(let e of n)e(t)}function broadcastFidChange(e,t){let n=getBroadcastChannel();n&&n.postMessage({key:e,fid:t}),closeBroadcastChannel()}let y=null;function getBroadcastChannel(){return!y&&"BroadcastChannel"in self&&((y=new BroadcastChannel("[Firebase] FID Change")).onmessage=e=>{callFidChangeCallbacks(e.data.key,e.data.fid)}),y}function closeBroadcastChannel(){0===m.size&&y&&(y.close(),y=null)}let b="firebase-installations-store",k=null;function getDbPromise(){return k||(k=(0,l.X3)("firebase-installations-database",1,{upgrade:(e,t)=>{0===t&&e.createObjectStore(b)}})),k}async function set(e,t){let n=getKey(e),a=await getDbPromise(),i=a.transaction(b,"readwrite"),r=i.objectStore(b),o=await r.get(n);return await r.put(t,n),await i.done,o&&o.fid===t.fid||fidChanged(e,t.fid),t}async function remove(e){let t=getKey(e),n=await getDbPromise(),a=n.transaction(b,"readwrite");await a.objectStore(b).delete(t),await a.done}async function update(e,t){let n=getKey(e),a=await getDbPromise(),i=a.transaction(b,"readwrite"),r=i.objectStore(b),o=await r.get(n),s=t(o);return void 0===s?await r.delete(n):await r.put(s,n),await i.done,s&&(!o||o.fid!==s.fid)&&fidChanged(e,s.fid),s}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function getInstallationEntry(e){let t;let n=await update(e.appConfig,n=>{let a=updateOrCreateInstallationEntry(n),i=triggerRegistrationIfNecessary(e,a);return t=i.registrationPromise,i.installationEntry});return""===n.fid?{installationEntry:await t}:{installationEntry:n,registrationPromise:t}}function updateOrCreateInstallationEntry(e){let t=e||{fid:generateFid(),registrationStatus:0};return clearTimedOutRequest(t)}function triggerRegistrationIfNecessary(e,t){if(0===t.registrationStatus){if(!navigator.onLine){let e=Promise.reject(w.create("app-offline"));return{installationEntry:t,registrationPromise:e}}let n={fid:t.fid,registrationStatus:1,registrationTime:Date.now()},a=registerInstallation(e,n);return{installationEntry:n,registrationPromise:a}}return 1===t.registrationStatus?{installationEntry:t,registrationPromise:waitUntilFidRegistration(e)}:{installationEntry:t}}async function registerInstallation(e,t){try{let n=await createInstallationRequest(e,t);return set(e.appConfig,n)}catch(n){throw isServerError(n)&&409===n.customData.serverCode?await remove(e.appConfig):await set(e.appConfig,{fid:t.fid,registrationStatus:0}),n}}async function waitUntilFidRegistration(e){let t=await updateInstallationRequest(e.appConfig);for(;1===t.registrationStatus;)await sleep(100),t=await updateInstallationRequest(e.appConfig);if(0===t.registrationStatus){let{installationEntry:t,registrationPromise:n}=await getInstallationEntry(e);return n||t}return t}function updateInstallationRequest(e){return update(e,e=>{if(!e)throw w.create("installation-not-found");return clearTimedOutRequest(e)})}function clearTimedOutRequest(e){return hasInstallationRequestTimedOut(e)?{fid:e.fid,registrationStatus:0}:e}function hasInstallationRequestTimedOut(e){return 1===e.registrationStatus&&e.registrationTime+1e4<Date.now()}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function generateAuthTokenRequest({appConfig:e,heartbeatServiceProvider:t},n){let a=getGenerateAuthTokenEndpoint(e,n),i=getHeadersWithAuth(e,n),r=t.getImmediate({optional:!0});if(r){let e=await r.getHeartbeatsHeader();e&&i.append("x-firebase-client",e)}let o={installation:{sdkVersion:p,appId:e.appId}},s={method:"POST",headers:i,body:JSON.stringify(o)},u=await retryIfServerError(()=>fetch(a,s));if(u.ok){let e=await u.json(),t=extractAuthTokenInfoFromResponse(e);return t}throw await getErrorFromResponse("Generate Auth Token",u)}function getGenerateAuthTokenEndpoint(e,{fid:t}){return`${getInstallationsEndpoint(e)}/${t}/authTokens:generate`}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function refreshAuthToken(e,t=!1){let n;let a=await update(e.appConfig,a=>{if(!isEntryRegistered(a))throw w.create("not-registered");let i=a.authToken;if(!t&&isAuthTokenValid(i))return a;if(1===i.requestStatus)return n=waitUntilAuthTokenRequest(e,t),a;{if(!navigator.onLine)throw w.create("app-offline");let t=makeAuthTokenRequestInProgressEntry(a);return n=fetchAuthTokenFromServer(e,t),t}}),i=n?await n:a.authToken;return i}async function waitUntilAuthTokenRequest(e,t){let n=await updateAuthTokenRequest(e.appConfig);for(;1===n.authToken.requestStatus;)await sleep(100),n=await updateAuthTokenRequest(e.appConfig);let a=n.authToken;return 0===a.requestStatus?refreshAuthToken(e,t):a}function updateAuthTokenRequest(e){return update(e,e=>{if(!isEntryRegistered(e))throw w.create("not-registered");let t=e.authToken;return hasAuthTokenRequestTimedOut(t)?{...e,authToken:{requestStatus:0}}:e})}async function fetchAuthTokenFromServer(e,t){try{let n=await generateAuthTokenRequest(e,t),a={...t,authToken:n};return await set(e.appConfig,a),n}catch(n){if(isServerError(n)&&(401===n.customData.serverCode||404===n.customData.serverCode))await remove(e.appConfig);else{let n={...t,authToken:{requestStatus:0}};await set(e.appConfig,n)}throw n}}function isEntryRegistered(e){return void 0!==e&&2===e.registrationStatus}function isAuthTokenValid(e){return 2===e.requestStatus&&!isAuthTokenExpired(e)}function isAuthTokenExpired(e){let t=Date.now();return t<e.creationTime||e.creationTime+e.expiresIn<t+36e5}function makeAuthTokenRequestInProgressEntry(e){let t={requestStatus:1,requestTime:Date.now()};return{...e,authToken:t}}function hasAuthTokenRequestTimedOut(e){return 1===e.requestStatus&&e.requestTime+1e4<Date.now()}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function getId(e){let{installationEntry:t,registrationPromise:n}=await getInstallationEntry(e);return n?n.catch(console.error):refreshAuthToken(e).catch(console.error),t.fid}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function getToken(e,t=!1){await completeInstallationRegistration(e);let n=await refreshAuthToken(e,t);return n.token}async function completeInstallationRegistration(e){let{registrationPromise:t}=await getInstallationEntry(e);t&&await t}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function extractAppConfig(e){if(!e||!e.options)throw getMissingValueError("App Configuration");if(!e.name)throw getMissingValueError("App Name");for(let t of["projectId","apiKey","appId"])if(!e.options[t])throw getMissingValueError(t);return{appName:e.name,projectId:e.options.projectId,apiKey:e.options.apiKey,appId:e.options.appId}}function getMissingValueError(e){return w.create("missing-app-config-values",{valueName:e})}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */let T="installations";(0,s.Xd)(new u.wA(T,e=>{let t=e.getProvider("app").getImmediate(),n=extractAppConfig(t),a=(0,s.qX)(t,"heartbeat");return{app:t,appConfig:n,heartbeatServiceProvider:a,_delete:()=>Promise.resolve()}},"PUBLIC")),(0,s.Xd)(new u.wA("installations-internal",e=>{let t=e.getProvider("app").getImmediate(),n=(0,s.qX)(t,T).getImmediate();return{getId:()=>getId(n),getToken:e=>getToken(n,e)}},"PRIVATE")),(0,s.KN)(d,g),(0,s.KN)(d,g,"esm2020");let I="BDOU99-h67HcA6JeFXHbSNMu7e2yNNu3RzoMj8TM4W88jITfq7ZmPvIM1Iv-4_l2LxQcYwhqby2xGpWwzjfAnG4",v="google.c.a.c_id";/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function arrayToBase64(e){let t=new Uint8Array(e),n=btoa(String.fromCharCode(...t));return n.replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}function base64ToArray(e){let t="=".repeat((4-e.length%4)%4),n=(e+t).replace(/\-/g,"+").replace(/_/g,"/"),a=atob(n),i=new Uint8Array(a.length);for(let e=0;e<a.length;++e)i[e]=a.charCodeAt(e);return i}(a=r||(r={}))[a.DATA_MESSAGE=1]="DATA_MESSAGE",a[a.DISPLAY_NOTIFICATION=3]="DISPLAY_NOTIFICATION",(i=o||(o={})).PUSH_RECEIVED="push-received",i.NOTIFICATION_CLICKED="notification-clicked";/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */let S="fcm_token_details_db",A="fcm_token_object_Store";async function migrateOldDatabase(e){if("databases"in indexedDB){let e=await indexedDB.databases(),t=e.map(e=>e.name);if(!t.includes(S))return null}let t=null,n=await (0,l.X3)(S,5,{upgrade:async(n,a,i,r)=>{if(a<2||!n.objectStoreNames.contains(A))return;let o=r.objectStore(A),s=await o.index("fcmSenderId").get(e);if(await o.clear(),s){if(2===a){if(!s.auth||!s.p256dh||!s.endpoint)return;t={token:s.fcmToken,createTime:s.createTime??Date.now(),subscriptionOptions:{auth:s.auth,p256dh:s.p256dh,endpoint:s.endpoint,swScope:s.swScope,vapidKey:"string"==typeof s.vapidKey?s.vapidKey:arrayToBase64(s.vapidKey)}}}else 3===a?t={token:s.fcmToken,createTime:s.createTime,subscriptionOptions:{auth:arrayToBase64(s.auth),p256dh:arrayToBase64(s.p256dh),endpoint:s.endpoint,swScope:s.swScope,vapidKey:arrayToBase64(s.vapidKey)}}:4===a&&(t={token:s.fcmToken,createTime:s.createTime,subscriptionOptions:{auth:arrayToBase64(s.auth),p256dh:arrayToBase64(s.p256dh),endpoint:s.endpoint,swScope:s.swScope,vapidKey:arrayToBase64(s.vapidKey)}})}}});return n.close(),await (0,l.Lj)(S),await (0,l.Lj)("fcm_vapid_details_db"),await (0,l.Lj)("undefined"),checkTokenDetails(t)?t:null}function checkTokenDetails(e){if(!e||!e.subscriptionOptions)return!1;let{subscriptionOptions:t}=e;return"number"==typeof e.createTime&&e.createTime>0&&"string"==typeof e.token&&e.token.length>0&&"string"==typeof t.auth&&t.auth.length>0&&"string"==typeof t.p256dh&&t.p256dh.length>0&&"string"==typeof t.endpoint&&t.endpoint.length>0&&"string"==typeof t.swScope&&t.swScope.length>0&&"string"==typeof t.vapidKey&&t.vapidKey.length>0}let C="firebase-messaging-store",E=null;function index_esm_getDbPromise(){return E||(E=(0,l.X3)("firebase-messaging-database",1,{upgrade:(e,t)=>{0===t&&e.createObjectStore(C)}})),E}async function dbGet(e){let t=function({appConfig:e}){return e.appId}(e),n=await index_esm_getDbPromise(),a=await n.transaction(C).objectStore(C).get(t);if(a)return a;{let t=await migrateOldDatabase(e.appConfig.senderId);if(t)return await dbSet(e,t),t}}async function dbSet(e,t){let n=function({appConfig:e}){return e.appId}(e),a=await index_esm_getDbPromise(),i=a.transaction(C,"readwrite");return await i.objectStore(C).put(t,n),await i.done,t}async function dbRemove(e){let t=function({appConfig:e}){return e.appId}(e),n=await index_esm_getDbPromise(),a=n.transaction(C,"readwrite");await a.objectStore(C).delete(t),await a.done}let _=new c.LL("messaging","Messaging",{"missing-app-config-values":'Missing App configuration value: "{$valueName}"',"only-available-in-window":"This method is available in a Window context.","only-available-in-sw":"This method is available in a service worker context.","permission-default":"The notification permission was not granted and dismissed instead.","permission-blocked":"The notification permission was not granted and blocked instead.","unsupported-browser":"This browser doesn't support the API's required to use the Firebase SDK.","indexed-db-unsupported":"This browser doesn't support indexedDb.open() (ex. Safari iFrame, Firefox Private Browsing, etc)","failed-service-worker-registration":"We are unable to register the default service worker. {$browserErrorMessage}","token-subscribe-failed":"A problem occurred while subscribing the user to FCM: {$errorInfo}","token-subscribe-no-token":"FCM returned no token when subscribing the user to push.","token-unsubscribe-failed":"A problem occurred while unsubscribing the user from FCM: {$errorInfo}","token-update-failed":"A problem occurred while updating the user from FCM: {$errorInfo}","token-update-no-token":"FCM returned no token when updating the user to push.","use-sw-after-get-token":"The useServiceWorker() method may only be called once and must be called before calling getToken() to ensure your service worker is used.","invalid-sw-registration":"The input to useServiceWorker() must be a ServiceWorkerRegistration.","invalid-bg-handler":"The input to setBackgroundMessageHandler() must be a function.","invalid-vapid-key":"The public VAPID key must be a string.","use-vapid-key-after-get-token":"The usePublicVapidKey() method may only be called once and must be called before calling getToken() to ensure your VAPID key is used."});/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function requestGetToken(e,t){let n;let a=await index_esm_getHeaders(e),i=getBody(t),r={method:"POST",headers:a,body:JSON.stringify(i)};try{let t=await fetch(getEndpoint(e.appConfig),r);n=await t.json()}catch(e){throw _.create("token-subscribe-failed",{errorInfo:e?.toString()})}if(n.error){let e=n.error.message;throw _.create("token-subscribe-failed",{errorInfo:e})}if(!n.token)throw _.create("token-subscribe-no-token");return n.token}async function requestUpdateToken(e,t){let n;let a=await index_esm_getHeaders(e),i=getBody(t.subscriptionOptions),r={method:"PATCH",headers:a,body:JSON.stringify(i)};try{let a=await fetch(`${getEndpoint(e.appConfig)}/${t.token}`,r);n=await a.json()}catch(e){throw _.create("token-update-failed",{errorInfo:e?.toString()})}if(n.error){let e=n.error.message;throw _.create("token-update-failed",{errorInfo:e})}if(!n.token)throw _.create("token-update-no-token");return n.token}async function requestDeleteToken(e,t){let n=await index_esm_getHeaders(e);try{let a=await fetch(`${getEndpoint(e.appConfig)}/${t}`,{method:"DELETE",headers:n}),i=await a.json();if(i.error){let e=i.error.message;throw _.create("token-unsubscribe-failed",{errorInfo:e})}}catch(e){throw _.create("token-unsubscribe-failed",{errorInfo:e?.toString()})}}function getEndpoint({projectId:e}){return`https://fcmregistrations.googleapis.com/v1/projects/${e}/registrations`}async function index_esm_getHeaders({appConfig:e,installations:t}){let n=await t.getToken();return new Headers({"Content-Type":"application/json",Accept:"application/json","x-goog-api-key":e.apiKey,"x-goog-firebase-installations-auth":`FIS ${n}`})}function getBody({p256dh:e,auth:t,endpoint:n,vapidKey:a}){let i={web:{endpoint:n,auth:t,p256dh:e}};return a!==I&&(i.web.applicationPubKey=a),i}async function getTokenInternal(e){let t=await getPushSubscription(e.swRegistration,e.vapidKey),n={vapidKey:e.vapidKey,swScope:e.swRegistration.scope,endpoint:t.endpoint,auth:arrayToBase64(t.getKey("auth")),p256dh:arrayToBase64(t.getKey("p256dh"))},a=await dbGet(e.firebaseDependencies);if(!a)return getNewToken(e.firebaseDependencies,n);if(isTokenValid(a.subscriptionOptions,n))return Date.now()>=a.createTime+6048e5?updateToken(e,{token:a.token,createTime:Date.now(),subscriptionOptions:n}):a.token;try{await requestDeleteToken(e.firebaseDependencies,a.token)}catch(e){console.warn(e)}return getNewToken(e.firebaseDependencies,n)}async function deleteTokenInternal(e){let t=await dbGet(e.firebaseDependencies);t&&(await requestDeleteToken(e.firebaseDependencies,t.token),await dbRemove(e.firebaseDependencies));let n=await e.swRegistration.pushManager.getSubscription();return!n||n.unsubscribe()}async function updateToken(e,t){try{let n=await requestUpdateToken(e.firebaseDependencies,t),a={...t,token:n,createTime:Date.now()};return await dbSet(e.firebaseDependencies,a),n}catch(e){throw e}}async function getNewToken(e,t){let n=await requestGetToken(e,t),a={token:n,createTime:Date.now(),subscriptionOptions:t};return await dbSet(e,a),a.token}async function getPushSubscription(e,t){let n=await e.pushManager.getSubscription();return n||e.pushManager.subscribe({userVisibleOnly:!0,applicationServerKey:base64ToArray(t)})}function isTokenValid(e,t){let n=t.vapidKey===e.vapidKey,a=t.endpoint===e.endpoint,i=t.auth===e.auth,r=t.p256dh===e.p256dh;return n&&a&&i&&r}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function externalizePayload(e){let t={from:e.from,collapseKey:e.collapse_key,messageId:e.fcmMessageId};return propagateNotificationPayload(t,e),propagateDataPayload(t,e),propagateFcmOptions(t,e),t}function propagateNotificationPayload(e,t){if(!t.notification)return;e.notification={};let n=t.notification.title;n&&(e.notification.title=n);let a=t.notification.body;a&&(e.notification.body=a);let i=t.notification.image;i&&(e.notification.image=i);let r=t.notification.icon;r&&(e.notification.icon=r)}function propagateDataPayload(e,t){t.data&&(e.data=t.data)}function propagateFcmOptions(e,t){if(!t.fcmOptions&&!t.notification?.click_action)return;e.fcmOptions={};let n=t.fcmOptions?.link??t.notification?.click_action;n&&(e.fcmOptions.link=n);let a=t.fcmOptions?.analytics_label;a&&(e.fcmOptions.analyticsLabel=a)}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function isConsoleMessage(e){return"object"==typeof e&&!!e&&v in e}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function index_esm_extractAppConfig(e){if(!e||!e.options)throw index_esm_getMissingValueError("App Configuration Object");if(!e.name)throw index_esm_getMissingValueError("App Name");let{options:t}=e;for(let e of["projectId","apiKey","appId","messagingSenderId"])if(!t[e])throw index_esm_getMissingValueError(e);return{appName:e.name,projectId:t.projectId,apiKey:t.apiKey,appId:t.appId,senderId:t.messagingSenderId}}function index_esm_getMissingValueError(e){return _.create("missing-app-config-values",{valueName:e})}!/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function(e,t){let n=[];for(let a=0;a<e.length;a++)n.push(e.charAt(a)),a<t.length&&n.push(t.charAt(a));n.join("")}("AzSCbw63g1R0nCw85jG8","Iaya3yLKwmgvh7cF0q4");/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */let MessagingService=class MessagingService{constructor(e,t,n){this.deliveryMetricsExportedToBigQueryEnabled=!1,this.onBackgroundMessageHandler=null,this.onMessageHandler=null,this.logEvents=[],this.isLogServiceStarted=!1;let a=index_esm_extractAppConfig(e);this.firebaseDependencies={app:e,appConfig:a,installations:t,analyticsProvider:n}}_delete(){return Promise.resolve()}};/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function registerDefaultSw(e){try{e.swRegistration=await navigator.serviceWorker.register("/firebase-messaging-sw.js",{scope:"/firebase-cloud-messaging-push-scope"}),e.swRegistration.update().catch(()=>{}),await waitForRegistrationActive(e.swRegistration)}catch(e){throw _.create("failed-service-worker-registration",{browserErrorMessage:e?.message})}}async function waitForRegistrationActive(e){return new Promise((t,n)=>{let a=setTimeout(()=>n(Error("Service worker not registered after 10000 ms")),1e4),i=e.installing||e.waiting;e.active?(clearTimeout(a),t()):i?i.onstatechange=e=>{e.target?.state==="activated"&&(i.onstatechange=null,clearTimeout(a),t())}:(clearTimeout(a),n(Error("No incoming service worker found.")))})}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function updateSwReg(e,t){if(t||e.swRegistration||await registerDefaultSw(e),t||!e.swRegistration){if(!(t instanceof ServiceWorkerRegistration))throw _.create("invalid-sw-registration");e.swRegistration=t}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function updateVapidKey(e,t){t?e.vapidKey=t:e.vapidKey||(e.vapidKey=I)}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function getToken$1(e,t){if(!navigator)throw _.create("only-available-in-window");if("default"===Notification.permission&&await Notification.requestPermission(),"granted"!==Notification.permission)throw _.create("permission-blocked");return await updateVapidKey(e,t?.vapidKey),await updateSwReg(e,t?.serviceWorkerRegistration),getTokenInternal(e)}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function logToScion(e,t,n){let a=getEventType(t),i=await e.firebaseDependencies.analyticsProvider.get();i.logEvent(a,{message_id:n[v],message_name:n["google.c.a.c_l"],message_time:n["google.c.a.ts"],message_device_time:Math.floor(Date.now()/1e3)})}function getEventType(e){switch(e){case o.NOTIFICATION_CLICKED:return"notification_open";case o.PUSH_RECEIVED:return"notification_foreground";default:throw Error()}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function messageEventListener(e,t){let n=t.data;if(!n.isFirebaseMessaging)return;e.onMessageHandler&&n.messageType===o.PUSH_RECEIVED&&("function"==typeof e.onMessageHandler?e.onMessageHandler(externalizePayload(n)):e.onMessageHandler.next(externalizePayload(n)));let a=n.data;isConsoleMessage(a)&&"1"===a["google.c.a.e"]&&await logToScion(e,n.messageType,a)}let R="@firebase/messaging",D="0.12.23";/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function isWindowSupported(){try{await (0,c.eu)()}catch(e){return!1}return"undefined"!=typeof window&&(0,c.hl)()&&(0,c.zI)()&&"serviceWorker"in navigator&&"PushManager"in window&&"Notification"in window&&"fetch"in window&&ServiceWorkerRegistration.prototype.hasOwnProperty("showNotification")&&PushSubscription.prototype.hasOwnProperty("getKey")}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function deleteToken$1(e){if(!navigator)throw _.create("only-available-in-window");return e.swRegistration||await registerDefaultSw(e),deleteTokenInternal(e)}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function onMessage$1(e,t){if(!navigator)throw _.create("only-available-in-window");return e.onMessageHandler=t,()=>{e.onMessageHandler=null}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function getMessagingInWindow(e=(0,s.Mq)()){return isWindowSupported().then(e=>{if(!e)throw _.create("unsupported-browser")},e=>{throw _.create("indexed-db-unsupported")}),(0,s.qX)((0,c.m9)(e),"messaging").getImmediate()}async function index_esm_getToken(e,t){return getToken$1(e=(0,c.m9)(e),t)}function deleteToken(e){return deleteToken$1(e=(0,c.m9)(e))}function onMessage(e,t){return onMessage$1(e=(0,c.m9)(e),t)}(0,s.Xd)(new u.wA("messaging",e=>{let t=new MessagingService(e.getProvider("app").getImmediate(),e.getProvider("installations-internal").getImmediate(),e.getProvider("analytics-internal"));return navigator.serviceWorker.addEventListener("message",e=>messageEventListener(t,e)),t},"PUBLIC")),(0,s.Xd)(new u.wA("messaging-internal",e=>{let t=e.getProvider("messaging").getImmediate();return{getToken:e=>getToken$1(t,e)}},"PRIVATE")),(0,s.KN)(R,D),(0,s.KN)(R,D,"esm2020")}}]);