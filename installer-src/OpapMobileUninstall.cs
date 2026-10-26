using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using Microsoft.Win32;

namespace OpapMobileUninstall
{
    public class Program
    {
        [STAThread]
        public static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            DialogResult confirm = MessageBox.Show(
                "Are you sure you want to completely remove OPAP Mobile from your computer?",
                "Uninstall OPAP Mobile",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question
            );

            if (confirm != DialogResult.Yes)
            {
                return;
            }

            try
            {
                // 1. Terminate running OPAP Mobile instances
                Process[] procs = Process.GetProcessesByName("OPAP-Mobile");
                foreach (Process p in procs)
                {
                    try
                    {
                        p.Kill();
                        p.WaitForExit(3000);
                    }
                    catch { }
                }

                // 2. Remove Desktop Shortcut
                string desktopPath = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string desktopShortcut = Path.Combine(desktopPath, "OPAP Mobile.lnk");
                if (File.Exists(desktopShortcut))
                {
                    try { File.Delete(desktopShortcut); } catch { }
                }

                // 3. Remove Start Menu Shortcut & Directory
                string programsPath = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
                string startMenuDir = Path.Combine(programsPath, "OPAP Mobile");
                if (Directory.Exists(startMenuDir))
                {
                    try { Directory.Delete(startMenuDir, true); } catch { }
                }

                // 4. Clean Registry
                using (RegistryKey parentKey = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall", true))
                {
                    if (parentKey != null)
                    {
                        try { parentKey.DeleteSubKeyTree("OPAP Mobile"); } catch { }
                    }
                }

                // 5. Remove Firewall Rules
                RemoveFirewallRules();

                string currentDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');

                // 6. Schedule folder deletion via detached cmd script
                string tempBat = Path.Combine(Path.GetTempPath(), "opap_uninstall_" + Guid.NewGuid().ToString("N") + ".bat");
                string batContent = string.Format(
                    "@echo off\r\n" +
                    "timeout /t 2 /nobreak >nul\r\n" +
                    "rmdir /s /q \"{0}\"\r\n" +
                    "del \"%~f0\"\r\n",
                    currentDir
                );
                File.WriteAllText(tempBat, batContent);

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = tempBat;
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process.Start(psi);

                MessageBox.Show(
                    "OPAP Mobile has been successfully uninstalled from your computer.",
                    "Uninstall Complete",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "An error occurred during uninstallation:\n" + ex.Message,
                    "Uninstall Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning
                );
            }
        }

        private static void RemoveFirewallRules()
        {
            try
            {
                RunHiddenCommand("netsh", "advfirewall firewall delete rule name=\"OPAP Mobile Application\"");
                RunHiddenCommand("netsh", "advfirewall firewall delete rule name=\"OPAP Mobile Intercom (TCP 8443)\"");
                RunHiddenCommand("netsh", "advfirewall firewall delete rule name=\"OPAP Mobile Discovery (UDP 8445)\"");
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
                    if (p != null) p.WaitForExit(3000);
                }
            }
            catch { }
        }
    }
}
