using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace OpapMobileLauncher
{
    public class Program
    {
        private const int AppPort = 8443;
        private const int BackendPort = 8444;

        private static Mutex singleInstanceMutex;
        private static NotifyIcon trayIcon;
        private static ContextMenuStrip trayMenu;
        
        private static HttpListener httpListener;
        private static Thread serverThread;
        private static TcpListener lanProxyListener;
        private static Thread proxyThread;
        private static volatile bool serverRunning = false;

        private static readonly List<HttpListenerResponse> sseClients = new List<HttpListenerResponse>();
        private static readonly object sseLock = new object();
        private static Process edgeProcess = null;
        private static Process pnpmProcess = null;
        private static string appRootDirectory;
        private static string distDirectory;

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        private const int SW_RESTORE = 9;

        private static void Trace(string msg)
        {
            try {
                string logFile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "opap_trace.log");
                File.AppendAllText(logFile, string.Format("[{0:HH:mm:ss.fff}] {1}\r\n", DateTime.Now, msg));
            } catch { }
        }

        private static SynchronizationContext uiContext;

        [STAThread]
        public static void Main(string[] args)
        {
            Trace("OPAP Mobile Launcher starting.");
            AppDomain.CurrentDomain.UnhandledException += (s, e) => {
                Trace("UNHANDLED CRASH: " + e.ExceptionObject.ToString());
            };

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            uiContext = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();

            // Single-instance Mutex check
            bool isNewInstance;
            singleInstanceMutex = new Mutex(true, "OPAP_Mobile_Single_Instance_v2", out isNewInstance);
            if (!isNewInstance)
            {
                Trace("Another instance already running. Showing alert and exiting.");
                MessageBox.Show(
                    "OPAP Mobile is already running.\nCheck your system tray (near the clock) or click the tray icon.",
                    "OPAP Mobile",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
                return;
            }

            // Path discovery
            appRootDirectory = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            if (File.Exists(Path.Combine(appRootDirectory, "package.json")))
            {
                // In project root
            }
            else if (File.Exists(Path.Combine(Directory.GetParent(appRootDirectory).FullName, "package.json")))
            {
                appRootDirectory = Directory.GetParent(appRootDirectory).FullName;
            }
            else if (Directory.Exists(@"c:\xampp\htdocs\OPAP Mobile"))
            {
                appRootDirectory = @"c:\xampp\htdocs\OPAP Mobile";
            }
            Trace("App root: " + appRootDirectory);

            distDirectory = Path.Combine(appRootDirectory, "dist");
            if (!Directory.Exists(distDirectory))
            {
                string localDist = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "dist");
                if (Directory.Exists(localDist)) distDirectory = localDist;
            }
            Trace("Dist directory: " + distDirectory);

            // Ensure server is active on port 8443
            EnsureServerRunning();

            // Initialize System Tray
            InitializeTray();

            // Launch the dedicated standalone desktop window (NOT in the browser!)
            LaunchStandaloneAppWindow();

            // Run application loop with ApplicationContext
            Trace("Entering Application.Run(new ApplicationContext())...");
            Application.Run(new ApplicationContext());
            Trace("Application loop exited.");

            // Shutdown and cleanup
            Shutdown();
            GC.KeepAlive(singleInstanceMutex);
        }

        private static void InitializeTray()
        {
            trayMenu = new ContextMenuStrip();

            string lanIp = GetLocalLanIp();
            ToolStripMenuItem titleItem = new ToolStripMenuItem(string.Format("OPAP Mobile ({0}:{1})", lanIp, AppPort));
            titleItem.Enabled = false;
            titleItem.Font = new Font(trayMenu.Font, FontStyle.Bold);
            trayMenu.Items.Add(titleItem);

            trayMenu.Items.Add(new ToolStripSeparator());

            ToolStripMenuItem openItem = new ToolStripMenuItem("Open OPAP Mobile Window", null, (s, e) => LaunchStandaloneAppWindow());
            openItem.Font = new Font(trayMenu.Font, FontStyle.Bold);
            trayMenu.Items.Add(openItem);

            trayMenu.Items.Add(new ToolStripMenuItem("Copy Mobile LAN Link (for Android)", null, (s, e) => CopyMobileLanLink()));
            trayMenu.Items.Add(new ToolStripMenuItem("Network & Pairing Info...", null, (s, e) => ShowLanInfo()));

            trayMenu.Items.Add(new ToolStripSeparator());

            trayMenu.Items.Add(new ToolStripMenuItem("Stop & Exit", null, (s, e) => {
                trayIcon.Visible = false;
                Application.Exit();
            }));

            trayIcon = new NotifyIcon();
            trayIcon.Text = string.Format("OPAP Mobile ({0})", AppPort);
            trayIcon.Icon = CreateAppIcon();
            trayIcon.ContextMenuStrip = trayMenu;
            trayIcon.Visible = true;

            trayIcon.DoubleClick += (s, e) => LaunchStandaloneAppWindow();

            trayIcon.ShowBalloonTip(
                3500,
                "OPAP Mobile Started",
                string.Format("Online at http://{0}:{1}\nDouble-click tray icon to open window.", lanIp, AppPort),
                ToolTipIcon.Info
            );
        }

        private static void EnsureServerRunning()
        {
            if (IsPortListening(AppPort))
            {
                Trace("Port " + AppPort + " is already active.");
                return;
            }

            // If dist directory exists with index.html, run high-performance embedded HTTP + LAN proxy
            if (Directory.Exists(distDirectory) && File.Exists(Path.Combine(distDirectory, "index.html")))
            {
                Trace("Starting embedded server and LAN proxy...");
                StartEmbeddedHttpServer();
                StartLanProxy();
            }
            else if (File.Exists(Path.Combine(appRootDirectory, "package.json")))
            {
                Trace("Starting headless pnpm dev...");
                StartHeadlessPnpmDev();
            }

            for (int i = 0; i < 24; i++)
            {
                if (IsPortListening(AppPort))
                {
                    Trace("Port " + AppPort + " confirmed active after " + (i * 250) + "ms.");
                    break;
                }
                Thread.Sleep(250);
            }
        }

        private static void StartEmbeddedHttpServer()
        {
            try
            {
                httpListener = new HttpListener();
                httpListener.Prefixes.Add(string.Format("http://127.0.0.1:{0}/", BackendPort));
                httpListener.Prefixes.Add(string.Format("http://localhost:{0}/", BackendPort));
                httpListener.Start();
                serverRunning = true;

                serverThread = new Thread(HttpServerWorker);
                serverThread.IsBackground = true;
                serverThread.Start();
                Trace("Embedded HttpListener listening on 127.0.0.1:" + BackendPort);
            }
            catch (Exception ex)
            {
                Trace("HttpListener failed: " + ex.Message);
                StartHeadlessPnpmDev();
            }
        }

        private static void StartLanProxy()
        {
            try
            {
                lanProxyListener = new TcpListener(IPAddress.Any, AppPort);
                lanProxyListener.Start();
                proxyThread = new Thread(LanProxyWorker);
                proxyThread.IsBackground = true;
                proxyThread.Start();
                Trace("LAN proxy listening on 0.0.0.0:" + AppPort + " -> 127.0.0.1:" + BackendPort);
            }
            catch (Exception ex)
            {
                Trace("LAN Proxy failed: " + ex.Message);
            }
        }

        private static void LanProxyWorker()
        {
            while (serverRunning && lanProxyListener != null)
            {
                try
                {
                    TcpClient client = lanProxyListener.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem(BridgeTcpConnection, client);
                }
                catch
                {
                    if (!serverRunning) break;
                }
            }
        }

        private static void BridgeTcpConnection(object state)
        {
            TcpClient client = (TcpClient)state;
            TcpClient backend = null;
            try
            {
                backend = new TcpClient("127.0.0.1", BackendPort);
                NetworkStream clientStream = client.GetStream();
                NetworkStream backendStream = backend.GetStream();

                Thread t1 = new Thread(() => StreamCopy(clientStream, backendStream, client, backend));
                Thread t2 = new Thread(() => StreamCopy(backendStream, clientStream, backend, client));
                t1.IsBackground = true;
                t2.IsBackground = true;
                t1.Start();
                t2.Start();
            }
            catch
            {
                try { client.Close(); } catch { }
                if (backend != null) try { backend.Close(); } catch { }
            }
        }

        private static void StreamCopy(NetworkStream fromStream, NetworkStream toStream, TcpClient fromClient, TcpClient toClient)
        {
            byte[] buffer = new byte[8192];
            try
            {
                int bytesRead;
                while ((bytesRead = fromStream.Read(buffer, 0, buffer.Length)) > 0)
                {
                    toStream.Write(buffer, 0, bytesRead);
                    toStream.Flush();
                }
            }
            catch { }
            finally
            {
                try { fromClient.Close(); } catch { }
                try { toClient.Close(); } catch { }
            }
        }

        private static void HttpServerWorker()
        {
            while (serverRunning && httpListener != null && httpListener.IsListening)
            {
                try
                {
                    HttpListenerContext context = httpListener.GetContext();
                    ThreadPool.QueueUserWorkItem(ProcessHttpRequest, context);
                }
                catch
                {
                    if (!serverRunning) break;
                }
            }
        }

        private static void ProcessHttpRequest(object state)
        {
            HttpListenerContext context = (HttpListenerContext)state;
            HttpListenerRequest request = context.Request;
            HttpListenerResponse response = context.Response;

            try
            {
                response.Headers["Access-Control-Allow-Origin"] = "*";
                response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
                response.Headers["Access-Control-Allow-Headers"] = "Content-Type";

                if (request.HttpMethod == "OPTIONS")
                {
                    response.StatusCode = 200;
                    response.Close();
                    return;
                }

                string rawUrl = request.Url.AbsolutePath;

                // 1. LAN SSE Event Stream
                if (rawUrl == "/api/p2p/events")
                {
                    response.ContentType = "text/event-stream";
                    response.Headers["Cache-Control"] = "no-cache";
                    response.Headers["Connection"] = "keep-alive";
                    response.SendChunked = true;

                    byte[] initialBuffer = Encoding.UTF8.GetBytes(": connected\n\n");
                    response.OutputStream.Write(initialBuffer, 0, initialBuffer.Length);
                    response.OutputStream.Flush();

                    lock (sseLock)
                    {
                        sseClients.Add(response);
                    }
                    return;
                }

                // 2. LAN Signaling Broadcast Bus
                if (rawUrl == "/api/p2p/broadcast" && request.HttpMethod == "POST")
                {
                    string body = "";
                    using (StreamReader reader = new StreamReader(request.InputStream, request.ContentEncoding))
                    {
                        body = reader.ReadToEnd();
                    }

                    int count = 0;
                    if (!string.IsNullOrEmpty(body))
                    {
                        string sseMsg = "data: " + body.Replace("\r", "").Replace("\n", "\ndata: ") + "\n\n";
                        byte[] msgBytes = Encoding.UTF8.GetBytes(sseMsg);

                        lock (sseLock)
                        {
                            List<HttpListenerResponse> deadClients = new List<HttpListenerResponse>();
                            foreach (HttpListenerResponse client in sseClients)
                            {
                                try
                                {
                                    client.OutputStream.Write(msgBytes, 0, msgBytes.Length);
                                    client.OutputStream.Flush();
                                    count++;
                                }
                                catch
                                {
                                    deadClients.Add(client);
                                }
                            }
                            foreach (HttpListenerResponse dead in deadClients)
                            {
                                sseClients.Remove(dead);
                            }
                        }
                    }

                    response.ContentType = "application/json";
                    byte[] resBytes = Encoding.UTF8.GetBytes(string.Format("{{\"ok\":true,\"clients\":{0}}}", count));
                    response.ContentLength64 = resBytes.Length;
                    response.OutputStream.Write(resBytes, 0, resBytes.Length);
                    response.Close();
                    return;
                }

                // 3. Static Files from dist/
                string relativePath = rawUrl.TrimStart('/');
                if (string.IsNullOrEmpty(relativePath))
                {
                    relativePath = "index.html";
                }

                string filePath = Path.Combine(distDirectory, relativePath.Replace('/', '\\'));
                if (!File.Exists(filePath))
                {
                    filePath = Path.Combine(distDirectory, "index.html");
                }

                if (File.Exists(filePath))
                {
                    response.ContentType = GetMimeType(Path.GetExtension(filePath));
                    byte[] fileBytes = File.ReadAllBytes(filePath);
                    response.ContentLength64 = fileBytes.Length;
                    response.OutputStream.Write(fileBytes, 0, fileBytes.Length);
                    response.Close();
                }
                else
                {
                    response.StatusCode = 404;
                    response.Close();
                }
            }
            catch
            {
                try { response.Close(); } catch { }
            }
        }

        private static string GetMimeType(string extension)
        {
            switch (extension.ToLowerInvariant())
            {
                case ".html": case ".htm": return "text/html; charset=utf-8";
                case ".js": case ".mjs": return "application/javascript; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".json": return "application/json; charset=utf-8";
                case ".svg": return "image/svg+xml";
                case ".png": return "image/png";
                case ".jpg": case ".jpeg": return "image/jpeg";
                case ".gif": return "image/gif";
                case ".ico": return "image/x-icon";
                case ".woff": return "font/woff";
                case ".woff2": return "font/woff2";
                case ".ttf": return "font/ttf";
                case ".txt": return "text/plain; charset=utf-8";
                default: return "application/octet-stream";
            }
        }

        private static void StartHeadlessPnpmDev()
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "cmd.exe";
                psi.Arguments = "/c pnpm run dev";
                psi.WorkingDirectory = appRootDirectory;
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.WindowStyle = ProcessWindowStyle.Hidden;

                string userNpm = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "npm");
                string nodeDir = @"C:\Program Files\nodejs";
                string currentPath = Environment.GetEnvironmentVariable("PATH") ?? "";
                if (!currentPath.Contains(userNpm)) currentPath = userNpm + ";" + currentPath;
                if (!currentPath.Contains(nodeDir)) currentPath = nodeDir + ";" + currentPath;
                psi.EnvironmentVariables["PATH"] = currentPath;

                pnpmProcess = Process.Start(psi);
                Trace("Started headless pnpm process PID=" + (pnpmProcess != null ? pnpmProcess.Id : 0));
            }
            catch (Exception ex)
            {
                Trace("StartHeadlessPnpmDev error: " + ex.Message);
            }
        }

        public static void LaunchStandaloneAppWindow()
        {
            if (edgeProcess != null && !edgeProcess.HasExited)
            {
                try
                {
                    ShowWindow(edgeProcess.MainWindowHandle, SW_RESTORE);
                    SetForegroundWindow(edgeProcess.MainWindowHandle);
                    return;
                }
                catch { }
            }

            string edgeExe = FindStandaloneBrowserExecutable();
            if (string.IsNullOrEmpty(edgeExe))
            {
                MessageBox.Show(
                    "Microsoft Edge or Google Chrome is required to run the standalone OPAP Mobile desktop window.\nPlease ensure Edge or Chrome is installed.",
                    "OPAP Mobile",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning
                );
                return;
            }

            string dataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "OPAP Mobile",
                "Profile"
            );
            if (!Directory.Exists(dataDir))
            {
                Directory.CreateDirectory(dataDir);
            }

            string targetUrl = string.Format("http://localhost:{0}", AppPort);
            
            // Standalone app mode: no address bar, no browser tabs, no browser navigation
            string arguments = string.Format(
                "--app=\"{0}\" --window-size=1240,860 --user-data-dir=\"{1}\" --app-id=OPAPMobile --disable-features=Translate,InterestFeedContentSuggestions --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream",
                targetUrl,
                dataDir
            );

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = edgeExe;
            psi.Arguments = arguments;
            psi.UseShellExecute = true;

            try
            {
                edgeProcess = Process.Start(psi);
                Trace("Launched standalone window PID=" + (edgeProcess != null ? edgeProcess.Id : 0));
                if (edgeProcess != null)
                {
                    edgeProcess.EnableRaisingEvents = true;
                    edgeProcess.Exited += (s, e) => {
                        Trace("Standalone window process exited / handed off.");
                        if (uiContext != null)
                        {
                            uiContext.Post(state => {
                                try {
                                    if (trayIcon != null && trayIcon.Visible)
                                    {
                                        trayIcon.ShowBalloonTip(
                                            2500,
                                            "OPAP Mobile",
                                            "OPAP Mobile background service is running in system tray.\nDouble-click tray icon to re-open or right-click to exit.",
                                            ToolTipIcon.Info
                                        );
                                    }
                                } catch { }
                            }, null);
                        }
                    };
                }
            }
            catch (Exception ex)
            {
                Trace("Error launching standalone window: " + ex.Message);
                MessageBox.Show("Could not launch standalone window:\n" + ex.Message, "OPAP Mobile Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static string FindStandaloneBrowserExecutable()
        {
            string[] paths = new string[]
            {
                @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Microsoft\Edge\Application\msedge.exe"),
                @"C:\Program Files\Google\Chrome\Application\chrome.exe",
                @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\Application\chrome.exe")
            };

            foreach (string p in paths)
            {
                if (File.Exists(p)) return p;
            }

            return null;
        }

        private static bool IsPortListening(int port)
        {
            try
            {
                IPGlobalProperties ipProps = IPGlobalProperties.GetIPGlobalProperties();
                IPEndPoint[] tcpListeners = ipProps.GetActiveTcpListeners();
                foreach (IPEndPoint ep in tcpListeners)
                {
                    if (ep.Port == port) return true;
                }
            }
            catch { }
            return false;
        }

        private static string GetLocalLanIp()
        {
            try
            {
                foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus == OperationalStatus.Up &&
                        ni.NetworkInterfaceType != NetworkInterfaceType.Loopback &&
                        !ni.Description.ToLower().Contains("virtual") &&
                        !ni.Description.ToLower().Contains("pseudo") &&
                        !ni.Description.ToLower().Contains("vmware") &&
                        !ni.Description.ToLower().Contains("hyper-v"))
                    {
                        foreach (UnicastIPAddressInformation ip in ni.GetIPProperties().UnicastAddresses)
                        {
                            if (ip.Address.AddressFamily == AddressFamily.InterNetwork)
                            {
                                string ipStr = ip.Address.ToString();
                                if (!ipStr.StartsWith("127.") && !ipStr.StartsWith("169.254."))
                                {
                                    return ipStr;
                                }
                            }
                        }
                    }
                }
            }
            catch { }
            return "127.0.0.1";
        }

        private static void CopyMobileLanLink()
        {
            string lanIp = GetLocalLanIp();
            string link = string.Format("http://{0}:{1}", lanIp, AppPort);
            try
            {
                Clipboard.SetText(link);
                trayIcon.ShowBalloonTip(
                    3000,
                    "Mobile LAN Link Copied!",
                    string.Format("Enter this URL on Android APK:\n{0}", link),
                    ToolTipIcon.Info
                );
            }
            catch
            {
                MessageBox.Show("Mobile LAN URL:\n" + link, "OPAP Mobile LAN URL", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }

        private static void ShowLanInfo()
        {
            string lanIp = GetLocalLanIp();
            string msg = string.Format(
                "OPAP Mobile LAN Intercom Station\n" +
                "-----------------------------------------\n" +
                "Status: Online & Ready\n" +
                "Port: {0}\n" +
                "Local PC Access: http://localhost:{0}\n" +
                "Android Mobile Link: http://{1}:{0}\n\n" +
                "To pair mobile devices:\n" +
                "1. Connect Android phone to the same Wi-Fi.\n" +
                "2. Launch OPAP Mobile APK on Android.\n" +
                "3. Enter http://{1}:{0} in Network Settings.\n\n" +
                "Both units will instantly discover each other for PTT and GSM voice calls!",
                AppPort, lanIp
            );

            MessageBox.Show(msg, "OPAP Mobile Network & Pairing Info", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private static Icon CreateAppIcon()
        {
            try
            {
                using (Bitmap bmp = new Bitmap(32, 32))
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    using (Brush bg = new SolidBrush(Color.FromArgb(15, 23, 42)))
                    {
                        g.FillEllipse(bg, 1, 1, 30, 30);
                    }
                    using (Pen ring = new Pen(Color.FromArgb(56, 189, 248), 2.5f))
                    {
                        g.DrawEllipse(ring, 2, 2, 28, 28);
                    }
                    using (Brush core = new SolidBrush(Color.FromArgb(16, 185, 129)))
                    {
                        g.FillEllipse(core, 10, 10, 12, 12);
                    }
                    IntPtr hIcon = bmp.GetHicon();
                    return Icon.FromHandle(hIcon);
                }
            }
            catch
            {
                return SystemIcons.Application;
            }
        }

        private static void Shutdown()
        {
            serverRunning = false;

            lock (sseLock)
            {
                foreach (HttpListenerResponse client in sseClients)
                {
                    try { client.Close(); } catch { }
                }
                sseClients.Clear();
            }

            if (lanProxyListener != null)
            {
                try { lanProxyListener.Stop(); } catch { }
                lanProxyListener = null;
            }

            if (httpListener != null)
            {
                try { httpListener.Stop(); } catch { }
                try { httpListener.Close(); } catch { }
                httpListener = null;
            }

            if (pnpmProcess != null && !pnpmProcess.HasExited)
            {
                try
                {
                    ProcessStartInfo killPsi = new ProcessStartInfo();
                    killPsi.FileName = "taskkill";
                    killPsi.Arguments = string.Format("/F /T /PID {0}", pnpmProcess.Id);
                    killPsi.CreateNoWindow = true;
                    killPsi.UseShellExecute = false;
                    killPsi.WindowStyle = ProcessWindowStyle.Hidden;
                    Process.Start(killPsi);
                }
                catch { }
            }
        }
    }
}
