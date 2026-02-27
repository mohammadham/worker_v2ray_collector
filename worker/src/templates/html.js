// ======== Dashboard HTML - COMPLETE VERSION ========
export function dashboardHTML(env) {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VPN Bot Pro Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Tahoma,sans-serif;background:#0a0a1a;color:#e0e0e0;min-height:100vh;direction:rtl}
.glass{background:rgba(255,255,255,.05);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.1);border-radius:16px}
.container{max-width:1400px;margin:0 auto;padding:20px}
.login-box{max-width:400px;margin:15vh auto;padding:40px;text-align:center}
.login-box h1{font-size:28px;margin-bottom:30px;color:#00d4ff}
input,textarea,select{width:100%;padding:12px 16px;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:rgba(255,255,255,.05);color:#fff;font-size:14px;margin-bottom:16px;outline:none;direction:ltr}
input:focus,textarea:focus,select:focus{border-color:#00d4ff}
button{padding:12px 24px;border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;transition:.3s}
.btn-primary{background:linear-gradient(135deg,#00d4ff,#0099cc);color:#000;width:100%}
.btn-primary:hover{opacity:.9;transform:translateY(-1px)}
.btn-danger{background:#ff4444;color:#fff;padding:8px 16px;font-size:12px}
.btn-success{background:#00cc66;color:#fff;padding:8px 16px;font-size:12px}
.btn-sm{padding:8px 16px;font-size:12px;background:rgba(0,212,255,.2);color:#00d4ff;border:1px solid rgba(0,212,255,.3)}
.header{display:flex;justify-content:space-between;align-items:center;padding:20px 30px;margin-bottom:30px}
.header h1{font-size:24px;color:#00d4ff}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:30px}
.stat-card{padding:24px;text-align:center}
.stat-card .num{font-size:36px;font-weight:700;color:#00d4ff}
.stat-card .label{color:#888;margin-top:8px;font-size:14px}
.tabs{display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap}
.tab{padding:10px 20px;border-radius:10px;cursor:pointer;background:rgba(255,255,255,.05);border:1px solid transparent;transition:.3s}
.tab.active{background:rgba(0,212,255,.15);border-color:#00d4ff;color:#00d4ff}
.section{display:none;padding:24px}
.section.active{display:block}
.list-item{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.05)}
.list-item:last-child{border-bottom:none}
.config-card{padding:16px;margin-bottom:12px;border-radius:12px;background:rgba(255,255,255,.03);position:relative}
.config-card code{display:block;word-break:break-all;font-size:11px;color:#888;margin-top:8px;background:rgba(0,0,0,.3);padding:8px;border-radius:6px}
.badge{padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;margin-right:8px}
.badge-active{background:rgba(0,255,100,.15);color:#0f0}
.badge-dead{background:rgba(255,0,0,.15);color:#f55}
.badge-dns{background:rgba(255,200,0,.15);color:#fa0}
.badge-pending{background:rgba(0,150,255,.15);color:#0af}
.add-row{display:flex;gap:12px;margin-bottom:16px}
.add-row input{margin-bottom:0;flex:1}
.voting{display:flex;gap:10px;margin-top:10px;align-items:center}
.vote-btn{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:#fff;padding:6px 12px;border-radius:6px;cursor:pointer;transition:.3s}
.vote-btn:hover{background:rgba(0,212,255,.2);border-color:#00d4ff}
.vote-btn.liked{color:#0f0;border-color:#0f0}
.vote-btn.disliked{color:#f55;border-color:#f55}
.settings-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin-bottom:20px}
.settings-item{display:flex;flex-direction:column}
.settings-item label{color:#00d4ff;margin-bottom:6px;font-size:13px}
.settings-item input,.settings-item select{background:rgba(0,0,0,.2)}
#app{min-height:100vh}
.loading{display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,.8);padding:20px 40px;border-radius:10px;z-index:1000}
.loading.active{display:block}
.pagination{display:flex;gap:10px;justify-content:center;margin-top:20px}
.page-btn{padding:8px 16px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:6px;cursor:pointer}
.page-btn.active{background:#00d4ff;color:#000}
.page-btn:disabled{opacity:.5;cursor:not-allowed}
.sort-bar{display:flex;gap:12px;margin-bottom:16px;align-items:center}
.sort-bar select{width:auto;min-width:150px}
</style>
</head>
<body>
<div id="app">
<div id="login-container" class="login-box glass">
<h1>🌐 VPN Bot Pro Panel</h1>
<input id="username" placeholder="Username" autocomplete="off">
<input id="password" type="password" placeholder="Password">
<button class="btn-primary" onclick="login()">Login</button>
<p id="login-error" style="color:#f55;margin-top:12px;display:none"></p>
</div>
<div id="dashboard" style="display:none">
<div class="header glass">
<h1>🌐 VPN Bot Pro Dashboard</h1>
<button class="btn-danger" onclick="logout()">Logout</button>
</div>
<div class="container">
<div class="stats-grid" id="stats"></div>
<div class="tabs">
<div class="tab active" onclick="showTab('links')">📋 Links</div>
<div class="tab" onclick="showTab('channels')">📺 Channels</div>
<div class="tab" onclick="showTab('configs')">🔰 Configs</div>
<div class="tab" onclick="showTab('templates')">📝 Templates</div>
<div class="tab" onclick="showTab('submissions')">👥 Submissions</div>
<div class="tab" onclick="showTab('settings')">⚙️ Settings</div>
<div class="tab" onclick="showTab('app-update')">📱 App Update</div>
<div class="tab" onclick="showTab('announcements')">📢 Announcements</div>
<div class="tab" onclick="showTab('broadcast')">✉️ Broadcast</div>
<div class="tab" onclick="showTab('actions')">⚡ Actions</div>
</div>
<div id="links" class="section active glass">
<div class="add-row"><input id="new-link" placeholder="https://..."><button class="btn-sm" onclick="addLink()">Add Link</button></div>
<div id="links-list"></div>
</div>
<div id="channels" class="section glass">
<div class="add-row"><input id="new-channel" placeholder="-100..."><button class="btn-sm" onclick="addChannel()">Add Channel</button></div>
<div id="channels-list"></div>
</div>
<div id="configs" class="section glass">
<div class="sort-bar">
<select id="sort-by" onchange="loadConfigs()">
<option value="newest">Newest First</option>
<option value="best">Best Rated</option>
<option value="latency">Lowest Ping</option>
<option value="active">Active Only</option>
</select>
<input type="number" id="limit-input" placeholder="Limit (10-100)" value="20" style="width:120px" onchange="loadConfigs()">
</div>
<div id="configs-list"></div>
<div class="pagination" id="pagination"></div>
</div>
<div id="templates" class="section glass">
<div style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
<div>
<label style="color:#00d4ff">Active Template:</label>
<select id="active-template" onchange="setActiveTemplate()" style="width:200px">
<option value="default">Default (Auto-detect)</option>
<option value="vless">VLESS Style</option>
<option value="vmess">VMess Style</option>
<option value="trojan">Trojan Style</option>
<option value="ss">Shadowsocks Style</option>
<option value="user_bundle">User Bundle Style</option>
</select>
</div>
<button class="btn-danger" onclick="resetTemplates()">Reset All to Defaults</button>
</div>
<div id="templates-list"></div>
</div>
<div id="submissions" class="section glass"><div id="submissions-list"></div></div>
<div id="settings" class="section glass">
<div class="settings-grid" id="settings-grid"></div>
<button class="btn-primary" onclick="saveSettings()">Save Settings</button>
<div style="margin-top:20px;padding:16px;background:rgba(0,212,255,.1);border-radius:8px">
<h3 style="color:#00d4ff;margin-bottom:12px">Redirect / Template Mode</h3>
<label style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
<input type="checkbox" id="enable-redirect" style="width:auto"> Enable Redirect instead of Template
</label>
<input id="redirect-url" placeholder="https://example.com" style="margin-bottom:12px">
<button class="btn-sm" onclick="saveRedirectSettings()">Save Redirect Settings</button>
</div>
</div>
<div id="announcements" class="section glass">
<div style="max-width:600px;margin:0 auto">
<h3 style="color:#00d4ff;margin-bottom:20px">In-App Announcements</h3>
<div class="settings-item"><label>Title</label><input id="ann-title"></div>
<div class="settings-item"><label>Message Content</label><textarea id="ann-message" style="height:120px"></textarea></div>
<label style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
<input type="checkbox" id="ann-active" style="width:auto"> Active (Visible in app)
</label>
<button class="btn-primary" onclick="saveAnnouncement()">Save Announcement</button>
</div>
</div>
<div id="broadcast" class="section glass">
<div style="max-width:600px;margin:0 auto;text-align:center">
<h3 style="color:#00d4ff;margin-bottom:20px">Broadcast Message to All Bot Users</h3>
<p style="color:#888;margin-bottom:20px;font-size:13px">This message will be sent to every user who has ever started the bot. This process may take time due to rate limiting.</p>
<textarea id="broadcast-message" placeholder="Type your message here (Markdown supported)..." style="height:200px"></textarea>
<button class="btn-primary" onclick="sendBroadcast()" style="background:linear-gradient(135deg,#ff9a9e,#fecfef);color:#000">🚀 Start Broadcast</button>
<div id="broadcast-status" style="margin-top:20px"></div>
</div>
</div>
<div id="app-update" class="section glass">
<div style="max-width:600px;margin:0 auto">
<h3 style="color:#00d4ff;margin-bottom:20px">Android App Update Management</h3>
<div class="settings-item"><label>Latest Version (e.g. 1.2.0)</label><input id="app-version"></div>
<div class="settings-item"><label>Download Link (APK URL)</label><input id="app-link"></div>
<div class="settings-item"><label>Update Description (Persian/English)</label><textarea id="app-description" style="height:120px"></textarea></div>
<label style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
<input type="checkbox" id="app-force" style="width:auto"> Force Update (Require users to update)
</label>
<button class="btn-primary" onclick="saveAppUpdate()">Save Update Info</button>
</div>
</div>
<div id="actions" class="section glass" style="text-align:center;padding:40px">
<button class="btn-primary" style="max-width:300px;margin:10px auto;display:block" onclick="fetchNow()">🔍 Fetch Configs Now</button>
<button class="btn-primary" style="max-width:300px;margin:10px auto;display:block;background:linear-gradient(135deg,#ff6b6b,#ee5a5a)" onclick="cleanupNow()">🗑️ Cleanup Dead Configs</button>
<button class="btn-primary" style="max-width:300px;margin:10px auto;display:block;background:linear-gradient(135deg,#4ecdc4,#44a08d)" onclick="retestAll()">🔄 Retest All Configs</button>
<div class="add-row" style="max-width:500px;margin:20px auto">
<input id="test-config-input" placeholder="vless://... or vmess://...">
<button class="btn-sm" onclick="testCfg()">Test</button>
</div>
<div id="test-result" style="margin-top:16px"></div>
<div id="action-result" style="margin-top:16px"></div>
</div>
</div>
</div>
</div>
<div class="loading" id="loading">Processing...</div>
<script>
let TOKEN="";let currentPage=1;let totalPages=1;const API="/dashboard/api";
function showLoading(){document.getElementById("loading").classList.add("active")}
function hideLoading(){document.getElementById("loading").classList.remove("active")}
async function api(path,method="GET",body=null){
  showLoading();
  const h={"Authorization":"Bearer "+TOKEN,"Content-Type":"application/json"};
  const opts={method,headers:h};
  if(body)opts.body=JSON.stringify(body);
  try{
    const r=await fetch(API+path,opts);
    const d=await r.json();
    hideLoading();
    return d;
  }catch(e){
    hideLoading();
    throw e;
  }
}
async function login(){
  const u=document.getElementById("username").value;
  const p=document.getElementById("password").value;
  const err = document.getElementById("login-error");
  err.style.display="none";
  showLoading();
  try{
    console.log("Attempting login to:", API + "/login");
    const r=await fetch(API+"/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:u,password:p})});
    const d=await r.json();
    hideLoading();
    if(r.ok && d.token){
      TOKEN=d.token;
      localStorage.setItem("token",TOKEN);
      await showDashboard();
    } else {
      err.style.display="block";
      err.textContent=d.error || "Invalid credentials";
    }
  }catch(e){
    hideLoading();
    err.style.display="block";
    err.textContent="Login failed: " + e.message;
    console.error("Login error:", e);
  }
}
function logout(){TOKEN="";localStorage.removeItem("token");location.reload();}
async function showDashboard(){
  try {
    document.getElementById("login-container").style.display="none";
    document.getElementById("dashboard").style.display="block";
    showLoading();
    await Promise.all([
      loadStats(), loadLinks(), loadChannels(), loadConfigs(),
      loadTemplates(), loadSubmissions(), loadSettings(), loadAppUpdate(),
      loadAnnouncements()
    ]);
    hideLoading();
  } catch (e) {
    hideLoading();
    alert("Error loading dashboard: " + e.message);
    console.error("Dashboard init error:", e);
  }
}
async function loadStats(){
  const d=await api("/stats");
  document.getElementById("stats").innerHTML=
    '<div class="stat-card glass"><div class="num">'+(d.total_configs||0)+'</div><div class="label">Total Configs</div></div>'+
    '<div class="stat-card glass"><div class="num">'+(d.active_configs||0)+'</div><div class="label">Active</div></div>'+
    '<div class="stat-card glass"><div class="num">'+(d.source_links||0)+'</div><div class="label">Links</div></div>'+
    '<div class="stat-card glass"><div class="num">'+(d.channels||0)+'</div><div class="label">Channels</div></div>'+
    '<div class="stat-card glass"><div class="num">'+(d.pending_submissions||0)+'</div><div class="label">Pending</div></div>'+
    '<div class="stat-card glass"><div class="num">'+(d.queue_size||0)+'</div><div class="label">Queue</div></div>'+
    '<div class="stat-card glass"><div class="num">'+(d.total_votes||0)+'</div><div class="label">Total Votes</div></div>';
}
async function loadLinks(){
  const d=await api("/links");
  document.getElementById("links-list").innerHTML=(d.links||[]).map((l,i)=>
    \`<div class="list-item"><span style="word-break:break-all;font-size:13px">\${l}</span><button class="btn-danger" onclick="removeLink('\${l}')">Remove</button></div>\`
  ).join("")||"<p>No links configured.</p>";
}
async function addLink(){const u=document.getElementById("new-link").value;if(u){await api("/links","POST",{url:u});document.getElementById("new-link").value="";loadLinks();loadStats();}}
async function removeLink(u){await api("/links","DELETE",{url:u});loadLinks();loadStats();}
async function loadChannels(){
  const d=await api("/channels");
  document.getElementById("channels-list").innerHTML=(d.channels||[]).map(c=>
    \`<div class="list-item"><span>\${c}</span><button class="btn-danger" onclick="removeChannel('\${c}')">Remove</button></div>\`
  ).join("")||"<p>No channels configured.</p>";
}
async function addChannel(){const c=document.getElementById("new-channel").value;if(c){await api("/channels","POST",{channel_id:c});document.getElementById("new-channel").value="";loadChannels();loadStats();}}
async function removeChannel(c){await api("/channels","DELETE",{channel_id:c});loadChannels();loadStats();}
function getFlag(code) {
  if (!code || code === "UN") return "🏳️";
  return code.toUpperCase().replace(/./g, c => String.fromCodePoint(c.charCodeAt(0) + 127397));
}
async function loadConfigs(page=1){
  currentPage=page;
  const sortBy=document.getElementById("sort-by").value;
  const limit=parseInt(document.getElementById("limit-input").value)||20;
  const d=await api("/configs?sort="+sortBy+"&limit="+limit+"&page="+page);
  totalPages=Math.ceil((d.total||0)/limit);

  document.getElementById("configs-list").innerHTML=(d.configs||[]).map(c=>{
    const badge=c.test_result?.status==="active"?"badge-active":c.test_result?.status==="dns_only"?"badge-dns":"badge-dead";
    const votes=c.votes||{likes:0,dislikes:0,score:0};
    const loc = getFlag(c.test_result?.countryCode) + " " + (c.test_result?.country || "Unknown");
    return \`<div class="config-card"><div style="display:flex;justify-content:space-between;align-items:center"><div><span class="badge \${badge}">\${c.type.toUpperCase()}</span><span style="font-size:12px">\${loc}</span></div><span style="color:#888;font-size:12px">\${c.test_result?.latency||"N/A"}ms</span></div><div style="margin:8px 0">\${c.test_result?.message} | Source: \${c.provider||'Unknown'}</div><div class="voting"><button class="vote-btn \${votes.userVoted==='like'?'liked':''}" onclick="vote('\${c.hash}','like')">👍 \${votes.likes}</button><button class="vote-btn \${votes.userVoted==='dislike'?'disliked':''}" onclick="vote('\${c.hash}','dislike')">👎 \${votes.dislikes}</button><span style="color:#00d4ff">Score: \${votes.score}</span></div><code>\${c.config}</code><div style="margin-top:10px"><button class="btn-danger" onclick="deleteConfig('\${c.hash}')">🗑️ Delete</button></div></div>\`;
  }).join("")||"<p>No configs yet.</p>";

  renderPagination();
}
function renderPagination(){
  let html='';
  for(let i=1;i<=totalPages;i++){
    html+='<button class="page-btn '+(i===currentPage?'active':'')+'" onclick="loadConfigs('+i+')">'+i+'</button>';
  }
  document.getElementById("pagination").innerHTML=html;
}
async function vote(hash,type){await api("/vote","POST",{config_hash:hash,vote:type});loadConfigs(currentPage);}
async function deleteConfig(hash){
  if(confirm("Are you sure you want to delete this config?")){
    await api("/configs/"+hash,"DELETE");
    loadConfigs(currentPage);
    loadStats();
  }
}
async function loadTemplates(){
  const d=await api("/templates");
  const t=d.templates||{};
  const active=d.activeTemplate||"default";
  document.getElementById("active-template").value=active;
  document.getElementById("templates-list").innerHTML=Object.entries(t).map(([k,v])=>
    \`<div style="margin-bottom:16px"><label style="color:#00d4ff;font-weight:600">\${k}</label><textarea id="tmpl_\${k}" style="margin-top:8px;height:80px">\${v}</textarea><button class="btn-sm" onclick="saveTemplate('\${k}')">Save</button></div>\`
  ).join("");
}
async function saveTemplate(type){const v=document.getElementById("tmpl_"+type).value;await api("/templates","POST",{type,template:v});alert("Saved!");}
async function resetTemplates(){if(confirm("Are you sure you want to reset all templates to default values?")){await api("/templates/reset","POST");loadTemplates();}}
async function setActiveTemplate(){
  const template=document.getElementById("active-template").value;
  await api("/settings","POST",{key:"activeTemplate",value:template});
}
async function loadSubmissions(){
  const d=await api("/submissions");
  document.getElementById("submissions-list").innerHTML=(d.submissions||[]).map(s=>{
    const id = s.id || btoa(s.configs?.[0] || "");
    const preview = (s.configs || []).slice(0, 2).join("\\n");
    return \`<div class="config-card"><span class="badge badge-pending">Bundle (\${s.configs?.length||0})</span> @\${s.username}<div style="color:#888;font-size:12px;margin:4px 0">Source: \${s.provider||'Unknown'}</div><code>\${preview}...</code><div style="margin-top:8px"><button class="btn-success" onclick="approveSub('\${id}')">✅ Approve</button> <button class="btn-danger" onclick="rejectSub('\${id}')">❌ Reject</button></div></div>\`;
  }).join("")||"<p>No pending submissions.</p>";
}
async function approveSub(id){await api("/submissions/approve","POST",{id});loadSubmissions();loadStats();}
async function rejectSub(id){await api("/submissions/reject","POST",{id});loadSubmissions();loadStats();}
async function loadSettings(){
  const d=await api("/settings");
  const s=d.settings||{};
  document.getElementById("settings-grid").innerHTML=
    '<div class="settings-item"><label>Max Failed Tests (before delete)</label><input type="number" id="setting-maxFailedTests" value="'+(s.maxFailedTests||1000)+'"></div>'+
    '<div class="settings-item"><label>Auto Delete Days (no likes)</label><input type="number" id="setting-autoDeleteDays" value="'+(s.autoDeleteDays||3)+'"></div>'+
    '<div class="settings-item"><label>Stale Delete Days (no update)</label><input type="number" id="setting-staleDeleteDays" value="'+(s.staleDeleteDays||5)+'"></div>'+
    '<div class="settings-item"><label>Min Likes to Keep</label><input type="number" id="setting-minLikesToKeep" value="'+(s.minLikesToKeep||1)+'"></div>'+
    '<div class="settings-item"><label>Rate Limit (msg/s)</label><input type="number" id="setting-rateLimit" value="'+(s.rateLimitPerSecond||30)+'"></div>'+
    '<div class="settings-item"><label>Queue Interval (min)</label><input type="number" id="setting-queueInterval" value="'+(s.queueIntervalMin||15)+'"></div>'+
    '<div class="settings-item"><label>Queue Batch Size</label><input type="number" id="setting-queueBatch" value="'+(s.queueBatchSize||1)+'"></div>'+
    '<div class="settings-item"><label>Main Channel Username (e.g. @MyChannel)</label><input id="setting-channelUsername" value="'+(s.channelUsername||"")+'"></div>'+
    '<div class="settings-item"><label>Enable Report Button</label><select id="setting-enableReport"><option value="true" '+(s.enableReportButton!==false?'selected':'')+'>Enabled</option><option value="false" '+(s.enableReportButton===false?'selected':'')+'>Disabled</option></select></div>'+
    '<div class="settings-item"><label>Enable QR Code Button</label><select id="setting-enableQR"><option value="true" '+(s.enableQRButton?'selected':'')+'>Enabled</option><option value="false" '+(s.enableQRButton?'':'selected')+'>Disabled</option></select></div>'+
    '<div class="settings-item"><label>Enable Queue</label><select id="setting-enableQueue"><option value="false" '+(s.enableQueue?'':'selected')+'>Disabled</option><option value="true" '+(s.enableQueue?'selected':'')+'>Enabled</option></select></div>';

  document.getElementById("enable-redirect").checked=s.enableRedirect||false;
  document.getElementById("redirect-url").value=s.redirectUrl||"";
}
async function saveSettings(){
  const settings={
    maxFailedTests:parseInt(document.getElementById("setting-maxFailedTests").value),
    autoDeleteDays:parseInt(document.getElementById("setting-autoDeleteDays").value),
    staleDeleteDays:parseInt(document.getElementById("setting-staleDeleteDays").value),
    minLikesToKeep:parseInt(document.getElementById("setting-minLikesToKeep").value),
    rateLimitPerSecond:parseInt(document.getElementById("setting-rateLimit").value),
    queueIntervalMin:parseInt(document.getElementById("setting-queueInterval").value),
    queueBatchSize:parseInt(document.getElementById("setting-queueBatch").value),
    channelUsername:document.getElementById("setting-channelUsername").value,
    enableReportButton:document.getElementById("setting-enableReport").value === "true",
    enableQRButton:document.getElementById("setting-enableQR").value === "true",
    enableQueue:document.getElementById("setting-enableQueue").value === "true"
  };
  await api("/settings","POST",{key:"all",value:settings});
  alert("Settings saved!");
}
async function saveRedirectSettings(){
  const enableRedirect=document.getElementById("enable-redirect").checked;
  const redirectUrl=document.getElementById("redirect-url").value;
  await api("/settings","POST",{key:"enableRedirect",value:enableRedirect});
  await api("/settings","POST",{key:"redirectUrl",value:redirectUrl});
  alert("Redirect settings saved!");
}
async function loadAppUpdate(){
  const d=await api("/app-update");
  if(d.info){
    document.getElementById("app-version").value=d.info.version||"";
    document.getElementById("app-link").value=d.info.link||"";
    document.getElementById("app-description").value=d.info.description||"";
    document.getElementById("app-force").checked=d.info.force||false;
  }
}
async function saveAppUpdate(){
  const body={
    version:document.getElementById("app-version").value,
    link:document.getElementById("app-link").value,
    description:document.getElementById("app-description").value,
    force:document.getElementById("app-force").checked
  };
  await api("/app-update","POST",body);
  alert("App update info saved!");
}
async function loadAnnouncements(){
  const d=await api("/announcements");
  if(d.announcement){
    document.getElementById("ann-title").value=d.announcement.title||"";
    document.getElementById("ann-message").value=d.announcement.message||"";
    document.getElementById("ann-active").checked=d.announcement.active||false;
  }
}
async function saveAnnouncement(){
  const body={
    title:document.getElementById("ann-title").value,
    message:document.getElementById("ann-message").value,
    active:document.getElementById("ann-active").checked
  };
  await api("/announcements","POST",body);
  alert("Announcement saved!");
}
async function sendBroadcast(){
  const msg=document.getElementById("broadcast-message").value;
  if(!msg || !confirm("Are you sure you want to send this message to ALL users?")) return;
  document.getElementById("broadcast-status").innerHTML="<p>Broadcast in progress... Please wait.</p>";
  try {
    const d=await api("/broadcast","POST",{message:msg});
    document.getElementById("broadcast-status").innerHTML="<p style='color:#0f0'>✅ Broadcast Completed!</p><p>Sent: "+d.stats.sent+" | Failed: "+d.stats.failed+"</p>";
    document.getElementById("broadcast-message").value="";
  } catch(e) {
    document.getElementById("broadcast-status").innerHTML="<p style='color:#f00'>❌ Error: "+e.message+"</p>";
  }
}
async function fetchNow(){
  document.getElementById("action-result").innerHTML="<p>Fetching...</p>";
  const d=await api("/fetch-now","POST");
  document.getElementById("action-result").innerHTML="<p>✅ New: "+(d.new_configs||0)+"</p>";
  loadConfigs();loadStats();
}
async function cleanupNow(){
  document.getElementById("action-result").innerHTML="<p>Cleaning up...</p>";
  const d=await api("/cleanup","POST");
  document.getElementById("action-result").innerHTML="<p>✅ Removed: "+(d.removed||0)+", Kept: "+(d.kept||0)+"</p>";
  loadConfigs();loadStats();
}
async function retestAll(){
  document.getElementById("action-result").innerHTML="<p>Retesting all configs...</p>";
  const d=await api("/retest-all","POST");
  document.getElementById("action-result").innerHTML="<p>✅ Retested: "+(d.tested||0)+"</p>";
  loadConfigs();
}
async function testCfg(){
  const c=document.getElementById("test-config-input").value;
  if(!c)return;
  document.getElementById("test-result").innerHTML="Testing...";
  const d=await api("/test","POST",{config:c});
  const badge=d.status==="active"?"badge-active":d.status==="dns_only"?"badge-dns":"badge-dead";
  document.getElementById("test-result").innerHTML='<span class="badge '+badge+'">'+d.message+'</span> Latency: '+(d.latency||"N/A")+'ms';
}
function showTab(name){
  document.querySelectorAll(".section").forEach(s=>s.classList.remove("active"));
  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
  document.getElementById(name).classList.add("active");
  event.target.classList.add("active");
}
window.onload=function(){
  const t=localStorage.getItem("token");
  if(t){TOKEN=t;showDashboard();}
};
</script>
</body></html>`;
}

// ======== Portfolio HTML - ویژگی جدید ========
export function portfolioHTML(env) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VPN Config Service</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
  color: #fff;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
.container {
  max-width: 800px;
  padding: 40px;
  text-align: center;
}
h1 { font-size: 3em; margin-bottom: 20px; background: linear-gradient(45deg, #00d4ff, #0099cc); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.subtitle { font-size: 1.2em; color: #aaa; margin-bottom: 40px; }
.features { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 40px 0; }
.feature { background: rgba(255,255,255,0.05); padding: 30px; border-radius: 15px; border: 1px solid rgba(255,255,255,0.1); transition: transform 0.3s; }
.feature:hover { transform: translateY(-5px); background: rgba(255,255,255,0.1); }
.feature-icon { font-size: 2.5em; margin-bottom: 15px; }
.feature h3 { color: #00d4ff; margin-bottom: 10px; }
.feature p { color: #aaa; font-size: 0.9em; }
.cta { margin-top: 40px; }
.btn {
  display: inline-block;
  padding: 15px 40px;
  background: linear-gradient(45deg, #00d4ff, #0099cc);
  color: #000;
  text-decoration: none;
  border-radius: 30px;
  font-weight: bold;
  margin: 10px;
  transition: transform 0.3s;
}
.btn:hover { transform: scale(1.05); }
.footer { margin-top: 60px; color: #666; font-size: 0.9em; }
</style>
</head>
<body>
<div class="container">
<h1>🌐 VPN Config Bot Pro</h1>
<p class="subtitle">Advanced VPN Configuration Management Service</p>

<div class="features">
<div class="feature">
<div class="feature-icon">⚡</div>
<h3>Fast Testing</h3>
<p>Automated latency and connectivity testing for all configs</p>
</div>
<div class="feature">
<div class="feature-icon">🛡️</div>
<h3>Quality Control</h3>
<p>Community voting system to ensure high-quality configs</p>
</div>
<div class="feature">
<div class="feature-icon">🤖</div>
<h3>Telegram Bot</h3>
<p>Easy submission and management through Telegram</p>
</div>
<div class="feature">
<div class="feature-icon">📊</div>
<h3>Dashboard</h3>
<p>Comprehensive web dashboard for administrators</p>
</div>
</div>

<div class="cta">
<a href="/dashboard" class="btn">Access Dashboard</a>
<a href="https://t.me/${env.BOT_USERNAME || 'your_bot'}" class="btn">Open Telegram Bot</a>
</div>

<div class="footer">
<p>Powered by Cloudflare Workers | Secure & Fast</p>
</div>
</div>
</body>
</html>`;
}
