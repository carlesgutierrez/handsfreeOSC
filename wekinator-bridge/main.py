import asyncio
import json
import logging
import threading
import tkinter as tk
from websockets.server import serve
from pythonosc.udp_client import SimpleUDPClient
import time
import os
import subprocess
import sys

try:
    import webview
    HAS_WEBVIEW = True
except ImportError:
    HAS_WEBVIEW = False

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# Configuration defaults
WS_HOST = "localhost"
WS_PORT = 8080
OSC_HOST = "127.0.0.1"
OSC_PORT = 6448 # Default Wekinator listening port
OSC_ADDRESS = "/wek/inputs"
DEBUG_MODE = True

client = None
last_ws_time = 0
last_osc_time = 0
last_ws_data = "Waiting for data..."
last_osc_data = "Waiting for data..."

def parse_config():
    """Simple parser for a config.txt file to allow user editing without touching code"""
    global WS_HOST, WS_PORT, OSC_HOST, OSC_PORT, OSC_ADDRESS, DEBUG_MODE
    try:
        if not os.path.exists("config.txt"):
            logging.info("config.txt not found, using default settings.")
            with open("config.txt", "w") as f:
                f.write("# HandsfreeOSC to Wekinator Bridge Configuration\n")
                f.write(f"WS_HOST={WS_HOST}\n")
                f.write(f"WS_PORT={WS_PORT}\n")
                f.write(f"OSC_HOST={OSC_HOST}\n")
                f.write(f"OSC_PORT={OSC_PORT}\n")
                f.write(f"OSC_ADDRESS={OSC_ADDRESS}\n")
                f.write("DEBUG_MODE=True\n")
            return None # No error

        with open("config.txt", "r") as f:
            for line_num, line in enumerate(f, 1):
                raw_line = line
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line: 
                    return f"Line {line_num} error: Expected KEY=VALUE format"
                key, val = line.split("=", 1)
                key, val = key.strip(), val.strip()
                
                try:
                    if key == "WS_HOST": WS_HOST = val
                    elif key == "WS_PORT": WS_PORT = int(val)
                    elif key == "OSC_HOST": OSC_HOST = val
                    elif key == "OSC_PORT": OSC_PORT = int(val)
                    elif key == "OSC_ADDRESS": OSC_ADDRESS = val
                    elif key == "DEBUG_MODE": DEBUG_MODE = val.lower() == "true"
                except ValueError:
                    return f"Line {line_num} error: Invalid value for {key}"
        logging.info("Loaded config.txt")
        return None # No error
    except Exception as e:
        return f"File error: {str(e)}"

async def handler(websocket):
    global last_ws_time, last_osc_time, last_ws_data, last_osc_data
    logging.info("Client connected to Python Bridge")
    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                last_ws_time = time.time()
                
                # Format WS data for display
                if DEBUG_MODE:
                    last_ws_data = json.dumps(data, indent=2)
                
                # Flatten the data structure for Wekinator
                wek_inputs = []
                
                # 1. Palm xy (2 items)
                if 'palm' in data:
                    wek_inputs.append(float(data['palm']['x']))
                    wek_inputs.append(float(data['palm']['y']))
                
                # 2. Fingers (5 fingers * 4 items = 20 items)
                fingers = ['thumb', 'index', 'middle', 'ring', 'pinky']
                for finger in fingers:
                    if finger in data:
                        f_data = data[finger]
                        wek_inputs.append(float(f_data['tip']['x']))
                        wek_inputs.append(float(f_data['tip']['y']))
                        wek_inputs.append(float(f_data['curl']))
                        wek_inputs.append(float(f_data['direction']))
                
                if len(wek_inputs) == 22:
                    if client is not None:
                        client.send_message(OSC_ADDRESS, wek_inputs)
                    last_osc_time = time.time()
                    if DEBUG_MODE:
                        last_osc_data = "\n".join([f"Val {i+1:02d}:  {v:.3f}" for i, v in enumerate(wek_inputs)])
                else:
                    logging.warning(f"Incomplete hand data received. Expected 22 inputs, got {len(wek_inputs)}")
                    
            except json.JSONDecodeError:
                logging.error("Failed to parse JSON message")
            except Exception as e:
                logging.error(f"Error processing message: {e}")
                
    except Exception as e:
        logging.info(f"Connection closed: {e}")

async def start_ws_server():
    global client
    client = SimpleUDPClient(OSC_HOST, OSC_PORT)
    logging.info(f"Starting Python Bridge...")
    logging.info(f"Listening for WebSockets on ws://{WS_HOST}:{WS_PORT}")
    logging.info(f"Forwarding flat OSC arrays (22 inputs) to {OSC_HOST}:{OSC_PORT}{OSC_ADDRESS}")
    
    try:
        async with serve(handler, WS_HOST, WS_PORT):
            await asyncio.Future()  # run forever
    except OSError as e:
        if e.errno == 10048:
            logging.error(f"PORT {WS_PORT} IS ALREADY IN USE! You must stop node server.js.")
            global last_ws_data
            last_ws_data = f"ERROR: Port {WS_PORT} already in use.\nDid you forget to stop node server.js?"

def run_asyncio_loop():
    asyncio.run(start_ws_server())

class BridgeGUI:
    def __init__(self, root, config_error):
        self.root = root
        self.config_error = config_error
        self.root.title("HandsfreeOSC to Wekinator")
        self.root.geometry("800x600")
        self.root.configure(bg="#1e1e2e")
        
        # Header Status
        header = tk.Frame(root, bg="#11111b", pady=15)
        header.pack(fill=tk.X)
        
        info_text = f"Listening: ws://{WS_HOST}:{WS_PORT}   →   Sending: osc://{OSC_HOST}:{OSC_PORT}{OSC_ADDRESS}"
        tk.Label(header, text=info_text, fg="#a6e3a1", bg="#11111b", font=("Consolas", 12, "bold")).pack()

        # Main Split Frame
        main_frame = tk.Frame(root, bg="#1e1e2e")
        main_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=20)
        main_frame.columnconfigure(0, weight=1)
        main_frame.columnconfigure(1, weight=1)
        
        # LEFT: WebSockets
        left = tk.Frame(main_frame, bg="#1e1e2e")
        left.grid(row=0, column=0, sticky="nsew", padx=10)
        
        tk.Label(left, text="Incoming WebSockets", fg="#cdd6f4", bg="#1e1e2e", font=("Arial", 14, "bold")).pack()
        
        self.ws_canvas = tk.Canvas(left, width=60, height=60, bg="#1e1e2e", highlightthickness=0)
        self.ws_circle = self.ws_canvas.create_oval(15, 15, 45, 45, fill="#f9e2af") # Yellow
        self.ws_canvas.pack(pady=10)
        
        if DEBUG_MODE:
            self.ws_text = tk.Text(left, bg="#181825", fg="#89dceb", font=("Consolas", 10), state=tk.DISABLED)
            self.ws_text.pack(fill=tk.BOTH, expand=True)

        # RIGHT: OSC
        right = tk.Frame(main_frame, bg="#1e1e2e")
        right.grid(row=0, column=1, sticky="nsew", padx=10)
        
        tk.Label(right, text="Outgoing OSC to Wekinator", fg="#cdd6f4", bg="#1e1e2e", font=("Arial", 14, "bold")).pack()
        
        self.osc_canvas = tk.Canvas(right, width=60, height=60, bg="#1e1e2e", highlightthickness=0)
        self.osc_circle = self.osc_canvas.create_oval(15, 15, 45, 45, fill="#f9e2af") # Yellow
        self.osc_canvas.pack(pady=10)
        
        if DEBUG_MODE:
            self.osc_text = tk.Text(right, bg="#181825", fg="#f38ba8", font=("Consolas", 10), state=tk.DISABLED)
            self.osc_text.pack(fill=tk.BOTH, expand=True)

        # Footer configuration
        footer = tk.Frame(root, bg="#11111b", pady=8)
        footer.pack(fill=tk.X, side=tk.BOTTOM)
        
        config_path = os.path.abspath("config.txt")
        if self.config_error:
            err_msg = f"CONFIG ERROR: {self.config_error}\nFormat must be KEY=VALUE. Click here to edit."
            self.config_lbl = tk.Label(footer, text=err_msg, fg="#f38ba8", bg="#11111b", font=("Arial", 9, "bold"), cursor="hand2")
        else:
            self.config_lbl = tk.Label(footer, text=f"Config file: {config_path} (Click to edit)", fg="#89b4fa", bg="#11111b", font=("Arial", 9, "underline"), cursor="hand2")
            
        self.config_lbl.pack()
        self.config_lbl.bind("<Button-1>", lambda e: self.open_config(config_path))
        
        if not DEBUG_MODE and not self.config_error:
            tk.Label(footer, text="Debug mode is OFF. Change DEBUG_MODE=True in config.txt to see values.", fg="#f9e2af", bg="#11111b", font=("Arial", 9)).pack()

        self.update_loop()

    def open_config(self, filepath):
        try:
            if sys.platform == "win32":
                os.startfile(filepath)
            elif sys.platform == "darwin":
                subprocess.call(["open", filepath])
            else:
                subprocess.call(["xdg-open", filepath])
        except Exception as e:
            logging.error(f"Could not open file: {e}")

    def update_loop(self):
        now = time.time()
        
        # Websocket status update
        if now - last_ws_time < 0.2:
            self.ws_canvas.itemconfig(self.ws_circle, fill="#a6e3a1") # Green
            if DEBUG_MODE:
                self.ws_text.config(state=tk.NORMAL)
                self.ws_text.delete("1.0", tk.END)
                self.ws_text.insert(tk.END, last_ws_data)
                self.ws_text.config(state=tk.DISABLED)
        else:
            self.ws_canvas.itemconfig(self.ws_circle, fill="#f9e2af") # Yellow
            
        # OSC status update
        if now - last_osc_time < 0.2:
            self.osc_canvas.itemconfig(self.osc_circle, fill="#a6e3a1") # Green
            if DEBUG_MODE:
                self.osc_text.config(state=tk.NORMAL)
                self.osc_text.delete("1.0", tk.END)
                self.osc_text.insert(tk.END, last_osc_data)
                self.osc_text.config(state=tk.DISABLED)
        else:
            self.osc_canvas.itemconfig(self.osc_circle, fill="#f9e2af") # Yellow
            
        self.root.after(50, self.update_loop)

# ── WEBVIEW APP ─────────────────────────────────────────────────────────────
HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <style>
        body { background: #11111b; color: #cdd6f4; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 25px; overflow: hidden; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; height: 380px; }
        .card { background: #1e1e2e; border-radius: 12px; padding: 18px; border: 1px solid #313244; display: flex; flex-direction: column; }
        h3 { margin-top: 0; color: #89b4fa; font-size: 16px; margin-bottom: 10px; }
        .status-row { display: flex; align-items: center; gap: 10px; font-family: 'Consolas', monospace; font-size: 12px; margin-bottom: 12px; }
        .dot { width: 10px; height: 10px; border-radius: 50%; background: #f9e2af; transition: all 0.2s; }
        .dot.active { background: #a6e3a1; box-shadow: 0 0 10px #a6e3a1; }
        pre { background: #11111b; padding: 10px; border-radius: 6px; font-size: 11px; flex: 1; overflow: auto; color: #89dceb; border: 1px solid #313244; }
        .osc-pre { color: #f38ba8; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #313244; padding-bottom: 10px; }
        .btn-config { background: #313244; color: #cdd6f4; border: none; padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 11px; text-decoration: underline; }
        .btn-config:hover { background: #45475a; }
        .footer { position: fixed; bottom: 0; left: 0; right: 0; background: #181825; padding: 8px 25px; font-size: 10px; color: #6c7086; display: flex; justify-content: space-between; }
    </style>
</head>
<body>
    <div class="header">
        <h2 style="margin:0; font-size: 20px; color: #cba6f7;">HandsfreeOSC <span style="font-weight: normal; font-size: 14px; color: #6c7086;">Bridge</span></h2>
        <button class="btn-config" onclick="window.pywebview.api.open_config()">Open config.txt</button>
    </div>
    <div class="grid">
        <div class="card">
            <h3>WebSockets</h3>
            <div class="status-row">
                <div id="ws-dot" class="dot"></div>
                <span id="ws-info">ws://localhost:8080</span>
            </div>
            <pre id="ws-data">Waiting for connection...</pre>
        </div>
        <div class="card">
            <h3>Wekinator (OSC)</h3>
            <div class="status-row">
                <div id="osc-dot" class="dot"></div>
                <span id="osc-info">127.0.0.1:6448</span>
            </div>
            <pre id="osc-data" class="osc-pre">Ready to send...</pre>
        </div>
    </div>
    <div class="footer">
        <span id="footer-path">Loading path...</span>
        <span id="footer-debug">DEBUG MODE: ON</span>
    </div>

    <script>
        function update(state) {
            document.getElementById('ws-dot').className = state.ws_active ? 'dot active' : 'dot';
            document.getElementById('osc-dot').className = state.osc_active ? 'dot active' : 'dot';
            if (state.debug) {
                document.getElementById('ws-data').innerText = state.ws_data;
                document.getElementById('osc-data').innerText = state.osc_data;
            }
            document.getElementById('ws-info').innerText = 'ws://' + state.ws_host + ':' + state.ws_port;
            document.getElementById('osc-info').innerText = state.osc_host + ':' + state.osc_port + state.osc_addr;
            document.getElementById('footer-path').innerText = 'Config: ' + state.config_path;
            document.getElementById('footer-debug').innerText = 'DEBUG MODE: ' + (state.debug ? 'ON' : 'OFF');
        }

        setInterval(async () => {
            const state = await window.pywebview.api.get_state();
            update(state);
        }, 100);
    </script>
</body>
</html>
"""

class BridgeApi:
    def get_state(self):
        now = time.time()
        return {
            "ws_active": (now - last_ws_time < 0.2),
            "osc_active": (now - last_osc_time < 0.2),
            "ws_data": last_ws_data,
            "osc_data": last_osc_data,
            "ws_host": WS_HOST,
            "ws_port": WS_PORT,
            "osc_host": OSC_HOST,
            "osc_port": OSC_PORT,
            "osc_addr": OSC_ADDRESS,
            "debug": DEBUG_MODE,
            "config_path": os.path.abspath("config.txt")
        }
    
    def open_config(self):
        filepath = os.path.abspath("config.txt")
        try:
            if sys.platform == "win32": os.startfile(filepath)
            elif sys.platform == "darwin": subprocess.call(["open", filepath])
            else: subprocess.call(["xdg-open", filepath])
        except: pass

def main():
    config_error = parse_config()
    
    # Run the socket server in a background thread
    t = threading.Thread(target=run_asyncio_loop, daemon=True)
    t.start()
    
    if HAS_WEBVIEW:
        # Use pywebview for a premium App feel
        api = BridgeApi()
        window = webview.create_window('HandsfreeOSC Bridge', html=HTML_TEMPLATE, js_api=api, width=800, height=520, resizable=False)
        webview.start()
    else:
        # Fallback to Tkinter if pywebview is not installed
        root = tk.Tk()
        app = BridgeGUI(root, config_error)
        root.mainloop()

if __name__ == "__main__":
    main()
