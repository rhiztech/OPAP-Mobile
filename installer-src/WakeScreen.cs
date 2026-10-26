using System;
using System.Runtime.InteropServices;

public class WakeScreen {
    [DllImport("user32.dll")]
    static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint SetThreadExecutionState(uint esFlags);

    const uint ES_SYSTEM_REQUIRED = 0x00000001;
    const uint ES_DISPLAY_REQUIRED = 0x00000002;
    const uint ES_CONTINUOUS = 0x80000000;
    const uint WM_SYSCOMMAND = 0x0112;
    const uint SC_MONITORPOWER = 0xF170;
    const uint MOUSEEVENTF_MOVE = 0x0001;

    [STAThread]
    public static void Main(string[] args) {
        try {
            // 1. Tell Windows kernel that system & display backlight are required immediately
            SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED);

            // 2. Broadcast display power ON command to Windows subsystem (HWND_BROADCAST = 0xffff, SC_MONITORPOWER = 0xF170, -1 = ON)
            SendMessage(new IntPtr(0xffff), WM_SYSCOMMAND, new IntPtr(SC_MONITORPOWER), new IntPtr(-1));

            // 3. Hardware mouse move simulation (1px right, 1px left) - triggers DWM/kernel monitor wake interrupt
            mouse_event(MOUSEEVENTF_MOVE, 1, 0, 0, UIntPtr.Zero);
            mouse_event(MOUSEEVENTF_MOVE, unchecked((uint)-1), 0, 0, UIntPtr.Zero);
        } catch {
            // Suppress any errors
        }
    }
}
