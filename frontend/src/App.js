import { useState, useEffect, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import { Shield, Link2, Tv, FileText, Users, Zap, LogOut, Plus, Trash2, RefreshCw, Search, Copy, CheckCircle, XCircle, AlertTriangle, Download, ChevronRight, Activity } from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const api = axios.create({ baseURL: API });

function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    localStorage.setItem("vpn_token", token);
  } else {
    delete api.defaults.headers.common["Authorization"];
    localStorage.removeItem("vpn_token");
  }
}

// Login Page
function LoginPage({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/auth/login", { username, password });
      setAuthToken(data.token);
      onLogin(data);
    } catch {
      setError("Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container" data-testid="login-page">
      <div className="login-card">
        <div className="login-icon"><Shield size={48} /></div>
        <h1>VPN Bot Panel</h1>
        <p className="login-subtitle">Manage your V2Ray proxy bot</p>
        <form onSubmit={handleLogin}>
          <input data-testid="login-username" type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
          <input data-testid="login-password" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
          <button data-testid="login-submit" type="submit" className="btn-primary" disabled={loading}>
            {loading ? "..." : "Login"}
          </button>
          {error && <p className="error-text" data-testid="login-error">{error}</p>}
        </form>
      </div>
    </div>
  );
}

// Stat Card
function StatCard({ icon: Icon, value, label, color }) {
  return (
    <div className="stat-card" data-testid={`stat-${label.toLowerCase().replace(/\s/g, '-')}`}>
      <div className="stat-icon" style={{ color }}><Icon size={24} /></div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

// Dashboard
function Dashboard({ onLogout }) {
  const [tab, setTab] = useState("overview");
  const [stats, setStats] = useState({});
  const [links, setLinks] = useState([]);
  const [channels, setChannels] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [templates, setTemplates] = useState({});
  const [submissions, setSubmissions] = useState([]);
  const [newLink, setNewLink] = useState("");
  const [newChannel, setNewChannel] = useState("");
  const [testConfig, setTestConfig] = useState("");
  const [testResult, setTestResult] = useState(null);
  const [actionMsg, setActionMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [workerScript, setWorkerScript] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [s, l, ch, c, t, sub] = await Promise.all([
        api.get("/dashboard/stats"),
        api.get("/dashboard/links"),
        api.get("/dashboard/channels"),
        api.get("/dashboard/configs"),
        api.get("/dashboard/templates"),
        api.get("/dashboard/submissions"),
      ]);
      setStats(s.data);
      setLinks(l.data.links || []);
      setChannels(ch.data.channels || []);
      setConfigs(c.data.configs || []);
      setTemplates(t.data.templates || {});
      setSubmissions(sub.data.submissions || []);
    } catch (e) {
      if (e.response?.status === 401) onLogout();
    }
  }, [onLogout]);

  useEffect(() => { loadData(); }, [loadData]);

  const addLink = async () => {
    if (!newLink) return;
    await api.post("/dashboard/links", { url: newLink });
    setNewLink("");
    loadData();
  };

  const removeLink = async (url) => {
    await api.delete("/dashboard/links", { data: { url } });
    loadData();
  };

  const addChannel = async () => {
    if (!newChannel) return;
    await api.post("/dashboard/channels", { channel_id: newChannel });
    setNewChannel("");
    loadData();
  };

  const removeChannel = async (id) => {
    await api.delete("/dashboard/channels", { data: { channel_id: id } });
    loadData();
  };

  const fetchNow = async () => {
    setLoading(true);
    setActionMsg("");
    try {
      const { data } = await api.post("/dashboard/fetch-now");
      setActionMsg(`New configs: ${data.new_configs}, Total checked: ${data.total_checked}`);
      loadData();
    } catch {
      setActionMsg("Error fetching configs");
    } finally { setLoading(false); }
  };

  const runTest = async () => {
    if (!testConfig) return;
    setTestResult(null);
    try {
      const { data } = await api.post("/dashboard/test-config", { config: testConfig });
      setTestResult(data);
    } catch { setTestResult({ status: "error", message: "Test failed" }); }
  };

  const approveSub = async (config) => {
    await api.post("/dashboard/submissions/approve", { config });
    loadData();
  };

  const rejectSub = async (config) => {
    await api.post("/dashboard/submissions/reject", { config });
    loadData();
  };

  const saveTemplate = async (type, value) => {
    await api.post("/dashboard/templates", { config_type: type, template: value });
    loadData();
  };

  const loadWorkerScript = async () => {
    try {
      const { data } = await api.get("/dashboard/worker-script");
      setWorkerScript(data.script || "Not found");
    } catch { setWorkerScript("Error loading script"); }
  };

  const copyConfig = (config) => {
    navigator.clipboard.writeText(config);
  };

  const tabs = [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "links", label: "Source Links", icon: Link2 },
    { id: "channels", label: "Channels", icon: Tv },
    { id: "configs", label: "Configs", icon: Shield },
    { id: "templates", label: "Templates", icon: FileText },
    { id: "submissions", label: "Submissions", icon: Users },
    { id: "actions", label: "Actions", icon: Zap },
    { id: "worker", label: "Worker Script", icon: Download },
  ];

  return (
    <div className="dashboard" data-testid="dashboard">
      <header className="dash-header">
        <div className="header-left">
          <Shield size={28} className="header-icon" />
          <h1>VPN Config Bot</h1>
        </div>
        <button data-testid="logout-btn" className="btn-logout" onClick={onLogout}><LogOut size={18} /> Logout</button>
      </header>

      <div className="dash-body">
        <nav className="sidebar">
          {tabs.map(t => (
            <button key={t.id} data-testid={`tab-${t.id}`} className={`nav-item ${tab === t.id ? "active" : ""}`} onClick={() => { setTab(t.id); if (t.id === "worker") loadWorkerScript(); }}>
              <t.icon size={18} /><span>{t.label}</span><ChevronRight size={14} className="nav-arrow" />
            </button>
          ))}
        </nav>

        <main className="main-content">
          {tab === "overview" && (
            <div data-testid="overview-section">
              <h2>Dashboard Overview</h2>
              <div className="stats-grid">
                <StatCard icon={Shield} value={stats.total_configs || 0} label="Total Configs" color="#00d4ff" />
                <StatCard icon={CheckCircle} value={stats.active_configs || 0} label="Active" color="#00ff88" />
                <StatCard icon={Link2} value={stats.source_links || 0} label="Source Links" color="#ff9500" />
                <StatCard icon={Tv} value={stats.channels || 0} label="Channels" color="#af52de" />
                <StatCard icon={Users} value={stats.pending_submissions || 0} label="Pending" color="#ff3b30" />
                <StatCard icon={Activity} value={stats.cache_size || 0} label="Cache Size" color="#5ac8fa" />
              </div>
            </div>
          )}

          {tab === "links" && (
            <div data-testid="links-section">
              <h2>Source Links</h2>
              <div className="add-row">
                <input data-testid="add-link-input" placeholder="https://example.com/configs..." value={newLink} onChange={e => setNewLink(e.target.value)} />
                <button data-testid="add-link-btn" className="btn-accent" onClick={addLink}><Plus size={16} /> Add</button>
              </div>
              <div className="list-container">
                {links.map((l, i) => (
                  <div key={i} className="list-item" data-testid={`link-item-${i}`}>
                    <span className="item-text">{l}</span>
                    <button className="btn-icon-danger" onClick={() => removeLink(l)}><Trash2 size={16} /></button>
                  </div>
                ))}
                {!links.length && <p className="empty-text">No source links configured</p>}
              </div>
            </div>
          )}

          {tab === "channels" && (
            <div data-testid="channels-section">
              <h2>Target Channels</h2>
              <div className="add-row">
                <input data-testid="add-channel-input" placeholder="-100..." value={newChannel} onChange={e => setNewChannel(e.target.value)} />
                <button data-testid="add-channel-btn" className="btn-accent" onClick={addChannel}><Plus size={16} /> Add</button>
              </div>
              <div className="list-container">
                {channels.map((c, i) => (
                  <div key={i} className="list-item" data-testid={`channel-item-${i}`}>
                    <span className="item-text">{c}</span>
                    <button className="btn-icon-danger" onClick={() => removeChannel(c)}><Trash2 size={16} /></button>
                  </div>
                ))}
                {!channels.length && <p className="empty-text">No channels configured</p>}
              </div>
            </div>
          )}

          {tab === "configs" && (
            <div data-testid="configs-section">
              <h2>Recent Configs ({configs.length})</h2>
              <div className="configs-list">
                {configs.map((c, i) => (
                  <div key={i} className="config-card" data-testid={`config-item-${i}`}>
                    <div className="config-header">
                      <span className={`badge badge-${c.type}`}>{c.type?.toUpperCase()}</span>
                      <span className={`status-badge ${c.test_result?.status === "active" ? "status-active" : c.test_result?.status === "dns_only" ? "status-warn" : "status-dead"}`}>
                        {c.test_result?.status === "active" ? <CheckCircle size={14} /> : c.test_result?.status === "dns_only" ? <AlertTriangle size={14} /> : <XCircle size={14} />}
                        {c.test_result?.message || "Unknown"}
                      </span>
                    </div>
                    <div className="config-server">{c.host || "N/A"}:{c.port || "N/A"}</div>
                    <code className="config-code">{c.config}</code>
                    <button className="btn-copy" onClick={() => copyConfig(c.config)}><Copy size={14} /> Copy</button>
                  </div>
                ))}
                {!configs.length && <p className="empty-text">No configs fetched yet. Use Actions tab to fetch.</p>}
              </div>
            </div>
          )}

          {tab === "templates" && (
            <div data-testid="templates-section">
              <h2>Message Templates</h2>
              <p className="help-text">Variables: {"{type}"}, {"{server}"}, {"{status}"}</p>
              {Object.entries(templates).map(([type, tmpl]) => (
                <div key={type} className="template-item">
                  <label>{type.toUpperCase()}</label>
                  <textarea data-testid={`template-${type}`} defaultValue={tmpl} onBlur={e => saveTemplate(type, e.target.value)} />
                </div>
              ))}
            </div>
          )}

          {tab === "submissions" && (
            <div data-testid="submissions-section">
              <h2>User Submissions</h2>
              {submissions.map((s, i) => (
                <div key={i} className="submission-card" data-testid={`submission-${i}`}>
                  <div className="sub-header">
                    <span className={`badge badge-${s.type}`}>{s.type?.toUpperCase()}</span>
                    <span className="sub-user">@{s.username || "unknown"}</span>
                  </div>
                  <code className="config-code">{s.config}</code>
                  <div className="sub-actions">
                    <button className="btn-approve" onClick={() => approveSub(s.config)}><CheckCircle size={14} /> Approve</button>
                    <button className="btn-reject" onClick={() => rejectSub(s.config)}><XCircle size={14} /> Reject</button>
                  </div>
                </div>
              ))}
              {!submissions.length && <p className="empty-text">No pending submissions</p>}
            </div>
          )}

          {tab === "actions" && (
            <div data-testid="actions-section">
              <h2>Actions</h2>
              <div className="action-card">
                <h3>Fetch Configs Now</h3>
                <p>Fetch from all source links, test, and distribute to channels</p>
                <button data-testid="fetch-now-btn" className="btn-primary" onClick={fetchNow} disabled={loading}>
                  <RefreshCw size={16} className={loading ? "spinning" : ""} /> {loading ? "Fetching..." : "Fetch Now"}
                </button>
                {actionMsg && <p className="action-result">{actionMsg}</p>}
              </div>
              <div className="action-card">
                <h3>Test Config</h3>
                <div className="add-row">
                  <input data-testid="test-config-input" placeholder="vless://... or vmess://..." value={testConfig} onChange={e => setTestConfig(e.target.value)} />
                  <button data-testid="test-config-btn" className="btn-accent" onClick={runTest}><Search size={16} /> Test</button>
                </div>
                {testResult && (
                  <div className={`test-result ${testResult.status === "active" ? "result-active" : testResult.status === "dns_only" ? "result-warn" : "result-dead"}`} data-testid="test-result">
                    <strong>{testResult.status?.toUpperCase()}</strong> - {testResult.message}
                    {testResult.latency > 0 && <span> ({testResult.latency}ms)</span>}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "worker" && (
            <div data-testid="worker-section">
              <h2>Cloudflare Worker Script</h2>
              <p className="help-text">Copy this script and deploy to Cloudflare Workers</p>
              <div className="worker-actions">
                <button className="btn-accent" onClick={() => copyConfig(workerScript)}><Copy size={16} /> Copy Script</button>
              </div>
              <pre className="worker-code">{workerScript || "Loading..."}</pre>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem("vpn_token");
    if (token) {
      setAuthToken(token);
      setUser({ username: "admin" });
    }
  }, []);

  const handleLogin = (data) => setUser(data);
  const handleLogout = () => {
    setAuthToken(null);
    setUser(null);
  };

  if (!user) return <LoginPage onLogin={handleLogin} />;
  return <Dashboard onLogout={handleLogout} />;
}

export default App;
