using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace OpapMobileSetup
{
    public class SetupForm : Form
    {
        private int currentPage = 0;
        private const int TotalPages = 6;

        // UI Panels & Controls
        private Panel headerPanel;
        private Label lblHeaderTitle;
        private Label lblHeaderSubtitle;
        private Panel contentPanel;
        private Panel footerPanel;
        private Button btnBack;
        private Button btnNext;
        private Button btnCancel;

        // Page 0: Welcome
        private Panel pnlWelcome;
        private Label lblWelcomeTitle;
        private Label lblWelcomeBody;

        // Page 1: Destination
        private Panel pnlDestination;
        private Label lblDestPrompt;
        private TextBox txtDestPath;
        private Button btnBrowse;
        private Label lblSpaceReq;

        // Page 2: Tasks
        private Panel pnlTasks;
        private Label lblTasksPrompt;
        private CheckBox chkDesktop;
        private CheckBox chkStartMenu;
        private CheckBox chkAutoLaunch;

        // Page 3: Ready
        private Panel pnlReady;
        private Label lblReadyPrompt;
        private TextBox txtSummary;

        // Page 4: Installing
        private Panel pnlInstalling;
        private Label lblInstallingPrompt;
        private ProgressBar progressBar;
        private Label lblStatus;

        // Page 5: Finished
        private Panel pnlFinished;
        private Label lblFinishedTitle;
        private Label lblFinishedBody;
        private CheckBox chkLaunchNow;

        private string defaultInstallPath;
        private string lanIp;

        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
        }

        public SetupForm()
        {
            lanIp = GetLocalLanIp();
            defaultInstallPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs",
                "OPAP Mobile"
            );

            InitializeComponent();
            ShowPage(0);
        }

        private void InitializeComponent()
        {
            this.Text = "OPAP Mobile Setup - Installation Wizard";
            this.Size = new Size(580, 460);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = true;
            this.Icon = CreateAppIcon();
            this.BackColor = Color.White;
            this.Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);

            // Header Panel
            headerPanel = new Panel();
            headerPanel.Dock = DockStyle.Top;
            headerPanel.Height = 70;
            headerPanel.BackColor = Color.FromArgb(15, 23, 42); // Slate 900
            this.Controls.Add(headerPanel);

            lblHeaderTitle = new Label();
            lblHeaderTitle.Text = "OPAP Mobile Setup";
            lblHeaderTitle.Font = new Font("Segoe UI", 12F, FontStyle.Bold, GraphicsUnit.Point);
            lblHeaderTitle.ForeColor = Color.White;
            lblHeaderTitle.Location = new Point(20, 14);
            lblHeaderTitle.AutoSize = true;
            headerPanel.Controls.Add(lblHeaderTitle);

            lblHeaderSubtitle = new Label();
            lblHeaderSubtitle.Text = "Enterprise LAN Intercom & Push-to-Talk Station";
            lblHeaderSubtitle.Font = new Font("Segoe UI", 8.5F, FontStyle.Regular, GraphicsUnit.Point);
            lblHeaderSubtitle.ForeColor = Color.FromArgb(148, 163, 184); // Slate 400
            lblHeaderSubtitle.Location = new Point(20, 38);
            lblHeaderSubtitle.AutoSize = true;
            headerPanel.Controls.Add(lblHeaderSubtitle);

            // Footer Panel
            footerPanel = new Panel();
            footerPanel.Dock = DockStyle.Bottom;
            footerPanel.Height = 55;
            footerPanel.BackColor = Color.FromArgb(248, 250, 252); // Slate 50
            footerPanel.Paint += (s, e) => {
                using (Pen p = new Pen(Color.FromArgb(226, 232, 240)))
                {
                    e.Graphics.DrawLine(p, 0, 0, footerPanel.Width, 0);
                }
            };
            this.Controls.Add(footerPanel);

            btnCancel = new Button();
            btnCancel.Text = "Cancel";
            btnCancel.Size = new Size(85, 30);
            btnCancel.Location = new Point(this.ClientSize.Width - 100, 12);
            btnCancel.Click += (s, e) => this.Close();
            footerPanel.Controls.Add(btnCancel);

            btnNext = new Button();
            btnNext.Text = "Next >";
            btnNext.Size = new Size(85, 30);
            btnNext.Location = new Point(this.ClientSize.Width - 195, 12);
            btnNext.Click += BtnNext_Click;
            footerPanel.Controls.Add(btnNext);

            btnBack = new Button();
            btnBack.Text = "< Back";
            btnBack.Size = new Size(85, 30);
            btnBack.Location = new Point(this.ClientSize.Width - 285, 12);
            btnBack.Click += (s, e) => ShowPage(currentPage - 1);
            footerPanel.Controls.Add(btnBack);

            // Content Panel
            contentPanel = new Panel();
            contentPanel.Dock = DockStyle.Fill;
            contentPanel.Padding = new Padding(24);
            this.Controls.Add(contentPanel);

            BuildPageWelcome();
            BuildPageDestination();
            BuildPageTasks();
            BuildPageReady();
            BuildPageInstalling();
            BuildPageFinished();
        }

        private void BuildPageWelcome()
        {
            pnlWelcome = new Panel { Dock = DockStyle.Fill, Visible = false };
            contentPanel.Controls.Add(pnlWelcome);

            lblWelcomeTitle = new Label();
            lblWelcomeTitle.Text = "Welcome to the OPAP Mobile Setup Wizard";
            lblWelcomeTitle.Font = new Font("Segoe UI", 12F, FontStyle.Bold);
            lblWelcomeTitle.ForeColor = Color.FromArgb(15, 23, 42);
            lblWelcomeTitle.Location = new Point(10, 15);
            lblWelcomeTitle.Size = new Size(500, 30);
            pnlWelcome.Controls.Add(lblWelcomeTitle);

            lblWelcomeBody = new Label();
            lblWelcomeBody.Text = 
                "This wizard will install OPAP Mobile on your computer.\r\n\r\n" +
                "OPAP Mobile provides a dedicated standalone intercom station for high-definition " +
                "voice calling, Push-to-Talk (PTT), GSM multi-call features (Call Waiting, Hold, Swap, " +
                "and 3-way Conferences), and instant LAN synchronization with Android mobile devices.\r\n\r\n" +
                "Key Highlights:\r\n" +
                "  • Runs as a dedicated standalone desktop app (not in a browser tab)\r\n" +
                "  • Completely silent background services (zero visible CMD windows)\r\n" +
                "  • Complies with Windows Application Installation Guidelines\r\n" +
                "  • Full WebRTC audio, microphone capture, and LAN mesh signaling\r\n\r\n" +
                "Click Next to continue, or Cancel to exit Setup.";
            lblWelcomeBody.Font = new Font("Segoe UI", 9F);
            lblWelcomeBody.ForeColor = Color.FromArgb(51, 65, 85);
            lblWelcomeBody.Location = new Point(10, 55);
            lblWelcomeBody.Size = new Size(510, 210);
            pnlWelcome.Controls.Add(lblWelcomeBody);
        }

        private void BuildPageDestination()
        {
            pnlDestination = new Panel { Dock = DockStyle.Fill, Visible = false };
            contentPanel.Controls.Add(pnlDestination);

            lblDestPrompt = new Label();
            lblDestPrompt.Text = "Select Destination Location\r\nWhere should OPAP Mobile be installed?";
            lblDestPrompt.Font = new Font("Segoe UI", 9.5F, FontStyle.Bold);
            lblDestPrompt.Location = new Point(10, 15);
            lblDestPrompt.Size = new Size(500, 40);
            pnlDestination.Controls.Add(lblDestPrompt);

            Label lblDestDesc = new Label();
            lblDestDesc.Text = "Setup will install OPAP Mobile into the following folder. To install to a different folder, click Browse.";
            lblDestDesc.Location = new Point(10, 65);
            lblDestDesc.Size = new Size(500, 35);
            pnlDestination.Controls.Add(lblDestDesc);

            txtDestPath = new TextBox();
            txtDestPath.Text = defaultInstallPath;
            txtDestPath.Location = new Point(10, 110);
            txtDestPath.Size = new Size(410, 26);
            pnlDestination.Controls.Add(txtDestPath);

            btnBrowse = new Button();
            btnBrowse.Text = "Browse...";
            btnBrowse.Location = new Point(430, 108);
            btnBrowse.Size = new Size(80, 28);
            btnBrowse.Click += (s, e) => {
                using (FolderBrowserDialog fbd = new FolderBrowserDialog())
                {
                    fbd.Description = "Select Destination Folder for OPAP Mobile";
                    fbd.SelectedPath = txtDestPath.Text;
                    if (fbd.ShowDialog() == DialogResult.OK)
                    {
                        txtDestPath.Text = Path.Combine(fbd.SelectedPath, "OPAP Mobile");
                    }
                }
            };
            pnlDestination.Controls.Add(btnBrowse);

            lblSpaceReq = new Label();
            lblSpaceReq.Text = "At least 20 MB of free disk space is required.\r\nInstalled under current user profile (no Administrator elevation required).";
            lblSpaceReq.ForeColor = Color.FromArgb(100, 116, 139);
            lblSpaceReq.Location = new Point(10, 155);
            lblSpaceReq.Size = new Size(500, 40);
            pnlDestination.Controls.Add(lblSpaceReq);
        }

        private void BuildPageTasks()
        {
            pnlTasks = new Panel { Dock = DockStyle.Fill, Visible = false };
            contentPanel.Controls.Add(pnlTasks);

            lblTasksPrompt = new Label();
            lblTasksPrompt.Text = "Select Additional Tasks\r\nWhich additional shortcuts and options should be configured?";
            lblTasksPrompt.Font = new Font("Segoe UI", 9.5F, FontStyle.Bold);
            lblTasksPrompt.Location = new Point(10, 15);
            lblTasksPrompt.Size = new Size(500, 40);
            pnlTasks.Controls.Add(lblTasksPrompt);

            chkDesktop = new CheckBox();
            chkDesktop.Text = "Create a Desktop shortcut";
            chkDesktop.Checked = true;
            chkDesktop.Location = new Point(15, 75);
            chkDesktop.Size = new Size(400, 25);
            pnlTasks.Controls.Add(chkDesktop);

            chkStartMenu = new CheckBox();
            chkStartMenu.Text = "Create a Start Menu Programs shortcut";
            chkStartMenu.Checked = true;
            chkStartMenu.Location = new Point(15, 110);
            chkStartMenu.Size = new Size(400, 25);
            pnlTasks.Controls.Add(chkStartMenu);

            chkAutoLaunch = new CheckBox();
            chkAutoLaunch.Text = "Launch OPAP Mobile immediately when installation finishes";
            chkAutoLaunch.Checked = true;
            chkAutoLaunch.Location = new Point(15, 145);
            chkAutoLaunch.Size = new Size(450, 25);
            pnlTasks.Controls.Add(chkAutoLaunch);
        }

        private void BuildPageReady()
        {
            pnlReady = new Panel { Dock = DockStyle.Fill, Visible = false };
            contentPanel.Controls.Add(pnlReady);

            lblReadyPrompt = new Label();
            lblReadyPrompt.Text = "Ready to Install\r\nSetup is now ready to begin installing OPAP Mobile on your computer.";
            lblReadyPrompt.Font = new Font("Segoe UI", 9.5F, FontStyle.Bold);
            lblReadyPrompt.Location = new Point(10, 15);
            lblReadyPrompt.Size = new Size(500, 40);
            pnlReady.Controls.Add(lblReadyPrompt);

            txtSummary = new TextBox();
            txtSummary.Multiline = true;
            txtSummary.ReadOnly = true;
            txtSummary.BackColor = Color.FromArgb(248, 250, 252);
            txtSummary.Location = new Point(10, 65);
            txtSummary.Size = new Size(500, 160);
            pnlReady.Controls.Add(txtSummary);
        }

        private void BuildPageInstalling()
        {
            pnlInstalling = new Panel { Dock = DockStyle.Fill, Visible = false };
            contentPanel.Controls.Add(pnlInstalling);

            lblInstallingPrompt = new Label();
            lblInstallingPrompt.Text = "Installing OPAP Mobile\r\nPlease wait while Setup installs OPAP Mobile on your computer.";
            lblInstallingPrompt.Font = new Font("Segoe UI", 9.5F, FontStyle.Bold);
            lblInstallingPrompt.Location = new Point(10, 15);
            lblInstallingPrompt.Size = new Size(500, 40);
            pnlInstalling.Controls.Add(lblInstallingPrompt);

            lblStatus = new Label();
            lblStatus.Text = "Preparing installation...";
            lblStatus.Location = new Point(10, 80);
            lblStatus.Size = new Size(500, 25);
            pnlInstalling.Controls.Add(lblStatus);

            progressBar = new ProgressBar();
            progressBar.Style = ProgressBarStyle.Continuous;
            progressBar.Minimum = 0;
            progressBar.Maximum = 100;
            progressBar.Value = 0;
            progressBar.Location = new Point(10, 110);
            progressBar.Size = new Size(500, 24);
            pnlInstalling.Controls.Add(progressBar);
        }

        private void BuildPageFinished()
        {
            pnlFinished = new Panel { Dock = DockStyle.Fill, Visible = false };
            contentPanel.Controls.Add(pnlFinished);

            lblFinishedTitle = new Label();
            lblFinishedTitle.Text = "Completing the OPAP Mobile Setup Wizard";
            lblFinishedTitle.Font = new Font("Segoe UI", 12F, FontStyle.Bold);
            lblFinishedTitle.ForeColor = Color.FromArgb(15, 23, 42);
            lblFinishedTitle.Location = new Point(10, 15);
            lblFinishedTitle.Size = new Size(500, 30);
            pnlFinished.Controls.Add(lblFinishedTitle);

            lblFinishedBody = new Label();
            lblFinishedBody.Text = string.Format(
                "Setup has finished installing OPAP Mobile on your computer.\r\n\r\n" +
                "The application may be launched by using the installed shortcuts or from the Start Menu.\r\n\r\n" +
                "Network & Mobile Pairing Information:\r\n" +
                "  • Local Station Port: 8443\r\n" +
                "  • Android Mobile LAN URL: http://{0}:8443\r\n" +
                "  • Android Companion APK: dist-installers\\OPAP-Mobile.apk\r\n\r\n" +
                "Click Finish to exit Setup.",
                lanIp
            );
            lblFinishedBody.Font = new Font("Segoe UI", 9F);
            lblFinishedBody.ForeColor = Color.FromArgb(51, 65, 85);
            lblFinishedBody.Location = new Point(10, 55);
            lblFinishedBody.Size = new Size(510, 160);
            pnlFinished.Controls.Add(lblFinishedBody);

            chkLaunchNow = new CheckBox();
            chkLaunchNow.Text = "Launch OPAP Mobile";
            chkLaunchNow.Checked = true;
            chkLaunchNow.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
            chkLaunchNow.Location = new Point(15, 220);
            chkLaunchNow.Size = new Size(300, 25);
            pnlFinished.Controls.Add(chkLaunchNow);
        }

        private void ShowPage(int page)
        {
            currentPage = page;
            pnlWelcome.Visible = (page == 0);
            pnlDestination.Visible = (page == 1);
            pnlTasks.Visible = (page == 2);
            pnlReady.Visible = (page == 3);
            pnlInstalling.Visible = (page == 4);
            pnlFinished.Visible = (page == 5);

            btnBack.Enabled = (page > 0 && page < 4);
            btnBack.Visible = (page < 5);

            if (page == 3)
            {
                btnNext.Text = "Install";
                txtSummary.Text = string.Format(
                    "Destination location:\r\n  {0}\r\n\r\nSelected shortcuts:\r\n  Desktop shortcut: {1}\r\n  Start Menu shortcut: {2}\r\n  Launch when finished: {3}",
                    txtDestPath.Text,
                    chkDesktop.Checked ? "Yes" : "No",
                    chkStartMenu.Checked ? "Yes" : "No",
                    chkAutoLaunch.Checked ? "Yes" : "No"
                );
            }
            else if (page == 4)
            {
                btnNext.Enabled = false;
                btnCancel.Enabled = false;
            }
            else if (page == 5)
            {
                btnNext.Text = "Finish";
                btnNext.Enabled = true;
                btnCancel.Visible = false;
                chkLaunchNow.Checked = chkAutoLaunch.Checked;
            }
            else
            {
                btnNext.Text = "Next >";
                btnNext.Enabled = true;
                btnCancel.Enabled = true;
            }
        }

        private void BtnNext_Click(object sender, EventArgs e)
        {
            if (currentPage == 0)
            {
                ShowPage(1);
            }
            else if (currentPage == 1)
            {
                if (string.IsNullOrEmpty(txtDestPath.Text.Trim()))
                {
                    MessageBox.Show("Please select a destination installation directory.", "OPAP Mobile Setup", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                ShowPage(2);
            }
            else if (currentPage == 2)
            {
                ShowPage(3);
            }
            else if (currentPage == 3)
            {
                ShowPage(4);
                PerformInstallation();
            }
            else if (currentPage == 5)
            {
                if (chkLaunchNow.Checked)
                {
                    string exePath = Path.Combine(txtDestPath.Text, "OPAP-Mobile.exe");
                    if (File.Exists(exePath))
                    {
                        ProcessStartInfo psi = new ProcessStartInfo();
                        psi.FileName = exePath;
                        psi.WorkingDirectory = txtDestPath.Text;
                        psi.UseShellExecute = true;
                        try { Process.Start(psi); } catch { }
                    }
                }
                this.Close();
            }
        }

        private void PerformInstallation()
        {
            BackgroundWorker worker = new BackgroundWorker();
            worker.WorkerReportsProgress = true;

            worker.DoWork += (s, e) => {
                string targetDir = txtDestPath.Text.Trim();
                if (!Directory.Exists(targetDir))
                {
                    Directory.CreateDirectory(targetDir);
                }

                worker.ReportProgress(10, "Stopping any existing OPAP Mobile processes...");
                foreach (Process p in Process.GetProcessesByName("OPAP-Mobile"))
                {
                    try { p.Kill(); p.WaitForExit(2000); } catch { }
                }

                worker.ReportProgress(25, "Deploying application binaries & assets...");
                
                // 1. Check for embedded payload.zip resource
                bool extractedFromPayload = false;
                try
                {
                    Assembly asm = Assembly.GetExecutingAssembly();
                    using (Stream resStream = asm.GetManifestResourceStream("payload.zip"))
                    {
                        if (resStream != null)
                        {
                            string tempZip = Path.Combine(Path.GetTempPath(), "opap_payload_" + Guid.NewGuid().ToString("N") + ".zip");
                            using (FileStream fs = File.Create(tempZip))
                            {
                                resStream.CopyTo(fs);
                            }
                            ZipFile.ExtractToDirectory(tempZip, targetDir);
                            try { File.Delete(tempZip); } catch { }
                            extractedFromPayload = true;
                        }
                    }
                }
                catch { }

                // 2. Fallback: Copy from local directory if payload was not embedded
                if (!extractedFromPayload)
                {
                    string currentDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
                    string standaloneDir = Path.Combine(currentDir, "OPAP-Mobile-win32-x64");
                    if (!Directory.Exists(standaloneDir)) standaloneDir = Path.Combine(currentDir, "dist-installers", "OPAP-Mobile-win32-x64");
                    
                    if (Directory.Exists(standaloneDir))
                    {
                        CopyDirectoryRecursive(standaloneDir, targetDir);
                    }
                    else
                    {
                        // Copy individual files if present
                        string launcherSrc = Path.Combine(currentDir, "OPAP-Mobile.exe");
                        if (!File.Exists(launcherSrc)) launcherSrc = Path.Combine(currentDir, "dist-installers", "OPAP-Mobile.exe");
                        if (File.Exists(launcherSrc)) File.Copy(launcherSrc, Path.Combine(targetDir, "OPAP-Mobile.exe"), true);

                        string uninstallerSrc = Path.Combine(currentDir, "Uninstall-OPAP-Mobile.exe");
                        if (!File.Exists(uninstallerSrc)) uninstallerSrc = Path.Combine(currentDir, "dist-installers", "Uninstall-OPAP-Mobile.exe");
                        if (File.Exists(uninstallerSrc)) File.Copy(uninstallerSrc, Path.Combine(targetDir, "Uninstall-OPAP-Mobile.exe"), true);
                    }
                }

                worker.ReportProgress(65, "Creating shortcuts...");
                string targetExe = Path.Combine(targetDir, "OPAP-Mobile.exe");

                if (chkDesktop.Checked)
                {
                    string desktopDir = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                    CreateShortcut(Path.Combine(desktopDir, "OPAP Mobile.lnk"), targetExe, targetDir, "OPAP Mobile Intercom & PTT Station");
                }

                if (chkStartMenu.Checked)
                {
                    string programsDir = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
                    string menuDir = Path.Combine(programsDir, "OPAP Mobile");
                    if (!Directory.Exists(menuDir)) Directory.CreateDirectory(menuDir);
                    CreateShortcut(Path.Combine(menuDir, "OPAP Mobile.lnk"), targetExe, targetDir, "OPAP Mobile Intercom & PTT Station");
                    
                    string uninstallerExe = Path.Combine(targetDir, "Uninstall-OPAP-Mobile.exe");
                    if (File.Exists(uninstallerExe))
                    {
                        CreateShortcut(Path.Combine(menuDir, "Uninstall OPAP Mobile.lnk"), uninstallerExe, targetDir, "Uninstall OPAP Mobile");
                    }

                    string fwBat = Path.Combine(targetDir, "Enable-OPAP-Firewall.bat");
                    if (File.Exists(fwBat))
                    {
                        CreateShortcut(Path.Combine(menuDir, "Repair Network & Firewall Rules.lnk"), fwBat, targetDir, "Authorize OPAP Mobile in Windows Defender Firewall");
                    }
                }

                worker.ReportProgress(85, "Registering Windows Uninstaller in Installed Apps...");
                RegisterWindowsUninstall(targetDir);

                worker.ReportProgress(92, "Configuring Windows Defender Firewall rules for LAN discovery...");
                ConfigureFirewallRules(targetExe);

                worker.ReportProgress(100, "Installation complete!");
                Thread.Sleep(500);
            };

            worker.ProgressChanged += (s, e) => {
                progressBar.Value = Math.Min(100, Math.Max(0, e.ProgressPercentage));
                lblStatus.Text = e.UserState as string;
            };

            worker.RunWorkerCompleted += (s, e) => {
                if (e.Error != null)
                {
                    MessageBox.Show("Installation encountered an issue:\n" + e.Error.Message, "Setup Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                ShowPage(5);
            };

            worker.RunWorkerAsync();
        }

        private static void CopyDirectoryRecursive(string sourceDir, string targetDir)
        {
            if (!Directory.Exists(targetDir)) Directory.CreateDirectory(targetDir);
            foreach (string file in Directory.GetFiles(sourceDir))
            {
                File.Copy(file, Path.Combine(targetDir, Path.GetFileName(file)), true);
            }
            foreach (string dir in Directory.GetDirectories(sourceDir))
            {
                CopyDirectoryRecursive(dir, Path.Combine(targetDir, Path.GetFileName(dir)));
            }
        }

        private static void CreateShortcut(string shortcutPath, string targetPath, string workingDir, string description)
        {
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                dynamic shell = Activator.CreateInstance(shellType);
                dynamic shortcut = shell.CreateShortcut(shortcutPath);
                shortcut.TargetPath = targetPath;
                shortcut.WorkingDirectory = workingDir;
                shortcut.Description = description;
                shortcut.IconLocation = targetPath + ",0";
                shortcut.Save();
            }
            catch { }
        }

        private static void RegisterWindowsUninstall(string targetDir)
        {
            try
            {
                using (RegistryKey parentKey = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall", true))
                {
                    if (parentKey != null)
                    {
                        using (RegistryKey appKey = parentKey.CreateSubKey("OPAP Mobile"))
                        {
                            if (appKey != null)
                            {
                                appKey.SetValue("DisplayName", "OPAP Mobile");
                                appKey.SetValue("DisplayVersion", "1.0.0");
                                appKey.SetValue("Publisher", "OPAP Systems");
                                appKey.SetValue("InstallLocation", targetDir);
                                appKey.SetValue("UninstallString", string.Format("\"{0}\"", Path.Combine(targetDir, "Uninstall-OPAP-Mobile.exe")));
                                appKey.SetValue("DisplayIcon", string.Format("\"{0}\",0", Path.Combine(targetDir, "OPAP-Mobile.exe")));
                                appKey.SetValue("EstimatedSize", 16384, RegistryValueKind.DWord);
                                appKey.SetValue("URLInfoAbout", "http://localhost:8443");
                                appKey.SetValue("Comments", "Enterprise LAN Intercom & Push-to-Talk Station");
                                appKey.SetValue("NoModify", 1, RegistryValueKind.DWord);
                                appKey.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                            }
                        }
                    }
                }
            }
            catch { }
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

        private static void ConfigureFirewallRules(string targetExe)
        {
            try
            {
                // Delete any old rules first (ignore errors on missing)
                RunHiddenCommand("netsh", "advfirewall firewall delete rule name=\"OPAP Mobile Application\"");
                RunHiddenCommand("netsh", "advfirewall firewall delete rule name=\"OPAP Mobile Standalone Application\"");
                RunHiddenCommand("netsh", "advfirewall firewall delete rule name=\"OPAP Mobile Intercom (TCP 8443)\"");
                RunHiddenCommand("netsh", "advfirewall firewall delete rule name=\"OPAP Mobile Discovery (UDP 8445)\"");
                RunHiddenCommand("netsh", "advfirewall firewall delete rule name=\"OPAP Mobile TCP Out\"");
                RunHiddenCommand("netsh", "advfirewall firewall delete rule name=\"OPAP Mobile UDP Out\"");
                RunHiddenCommand("netsh", "advfirewall firewall delete rule name=\"OPAP Mobile ICMP In\"");
                RunHiddenCommand("netsh", "advfirewall firewall delete rule name=\"OPAP Mobile ICMP Out\"");

                // Remove any Block rules Windows auto-created for OPAP
                RunHiddenCommand("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -Command \"Get-NetFirewallRule | Where-Object { ($_.DisplayName -like '*OPAP*' -or $_.Name -like '*OPAP*') -and $_.Action -eq 'Block' } | Remove-NetFirewallRule\"");

                // 1. Inbound application rule (all traffic for this exe)
                RunHiddenCommand("netsh", string.Format("advfirewall firewall add rule name=\"OPAP Mobile Application\" dir=in action=allow program=\"{0}\" enable=yes profile=any", targetExe));
                // 2. Inbound TCP port 8443 (HTTP & Intercom Signaling)
                RunHiddenCommand("netsh", "advfirewall firewall add rule name=\"OPAP Mobile Intercom (TCP 8443)\" dir=in action=allow protocol=TCP localport=8443 profile=any");
                // 3. Inbound UDP port 8445 (LAN Peer Discovery Beacon)
                RunHiddenCommand("netsh", "advfirewall firewall add rule name=\"OPAP Mobile Discovery (UDP 8445)\" dir=in action=allow protocol=UDP localport=8445 profile=any");
                // 4. Outbound TCP to port 8443 on peer stations
                RunHiddenCommand("netsh", "advfirewall firewall add rule name=\"OPAP Mobile TCP Out\" dir=out action=allow protocol=TCP remoteport=8443 profile=any");
                // 5. Outbound UDP broadcasts to port 8445
                RunHiddenCommand("netsh", "advfirewall firewall add rule name=\"OPAP Mobile UDP Out\" dir=out action=allow protocol=UDP remoteport=8445 profile=any");
                // 6. Inbound ICMP Echo Request (allow ping)
                RunHiddenCommand("netsh", "advfirewall firewall add rule name=\"OPAP Mobile ICMP In\" dir=in action=allow protocol=ICMPv4 profile=any");
                // 7. Outbound ICMP Echo (allow ping out)
                RunHiddenCommand("netsh", "advfirewall firewall add rule name=\"OPAP Mobile ICMP Out\" dir=out action=allow protocol=ICMPv4 profile=any");

                // Enable Windows built-in Network Discovery & File Sharing for all profiles
                RunHiddenCommand("netsh", "advfirewall firewall set rule group=\"Network Discovery\" new enable=yes profile=any");
                RunHiddenCommand("netsh", "advfirewall firewall set rule group=\"File and Printer Sharing\" new enable=yes profile=any");

                // Enable and start Windows Network Discovery Services
                RunHiddenCommand("sc.exe", "config fdPHost start= auto");
                RunHiddenCommand("net.exe", "start fdPHost");
                RunHiddenCommand("sc.exe", "config FDResPub start= auto");
                RunHiddenCommand("net.exe", "start FDResPub");

                // Set active network connection profiles to Private (essential for LAN discovery on Windows 10/11)
                RunHiddenCommand("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -Command \"Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -ne 'DomainAuthenticated' } | Set-NetConnectionProfile -NetworkCategory Private\"");

                // Direct Registry approach: Set all Network Categories to Private (1) to guarantee discovery works
                try
                {
                    using (RegistryKey profilesKey = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion\NetworkList\Profiles", true))
                    {
                        if (profilesKey != null)
                        {
                            foreach (string subKeyName in profilesKey.GetSubKeyNames())
                            {
                                using (RegistryKey profileKey = profilesKey.OpenSubKey(subKeyName, true))
                                {
                                    if (profileKey != null)
                                    {
                                        object catObj = profileKey.GetValue("Category");
                                        if (catObj != null && Convert.ToInt32(catObj) == 0) // 0 = Public
                                        {
                                            profileKey.SetValue("Category", 1, RegistryValueKind.DWord); // 1 = Private
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                catch { }
            }
            catch { }
        }

        private static void RunHiddenCommand(string exe, string args)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = exe;
                psi.Arguments = args;
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                using (Process p = Process.Start(psi))
                {
                    if (p != null) p.WaitForExit(8000);
                }
            }
            catch { }
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
    }
}
