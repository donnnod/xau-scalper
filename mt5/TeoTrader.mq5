//+------------------------------------------------------------------+
//| TeoTrader.mq5                                                     |
//|                                                                   |
//| Executes orders the dashboard drops as JSON command files, and    |
//| writes the fill (or rejection) back as a response file.           |
//|                                                                   |
//| WHY A FILE BRIDGE                                                 |
//| There is no macOS/Linux MetaTrader5 Python package, so the server |
//| cannot call this terminal directly. It can, however, write a      |
//| small JSON file into MQL5/Files, which is a real directory on the |
//| host. This EA is the other half of that bridge: it reads commands |
//| the server writes and turns them into OrderSend calls.            |
//|                                                                   |
//| PROTOCOL                                                          |
//|   server → EA   teo\\commands\\<clientId>.json                    |
//|   EA → server   teo\\responses\\<clientId>.json                   |
//| clientId is a UUID and also the server's idempotency key. This EA |
//| processes each command exactly once: it writes the response, then |
//| deletes the command file, and refuses any clientId whose response |
//| already exists.                                                   |
//|                                                                   |
//| COMMAND SHAPES                                                    |
//|   OPEN : {clientId, action:"OPEN", symbol, side:"BUY"|"SELL",     |
//|           lots, sl, tp, comment}                                  |
//|   CLOSE: {clientId, action:"CLOSE", symbol, ticket}              |
//| RESPONSE:{clientId, ok:true|false, ticket, price, error}          |
//|                                                                   |
//| INSTALL                                                           |
//|   1. In MT5: File → Open Data Folder → MQL5 → Experts             |
//|   2. Copy this file there                                         |
//|   3. In MetaEditor press F7 to compile                            |
//|   4. Drag "TeoTrader" onto any chart                              |
//|   5. Enable "Allow Algo Trading" (the toolbar button) and, in the |
//|      EA dialog, "Allow live trading".                             |
//|                                                                   |
//| SAFETY                                                            |
//|   * Refuses lots above InpMaxLots.                                |
//|   * Refuses a symbol not in InpAllowedSymbols (when set).         |
//|   * Tags every order with InpMagic so it only ever closes its own.|
//+------------------------------------------------------------------+
#property copyright "XAU Scalper"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>

//--- Subdirectory under MQL5/Files the server and this EA share.
input string InpBridgeDir      = "teo";
//--- Poll interval in seconds. 2s keeps latency low without busy-spinning.
input int    InpIntervalSecs   = 2;
//--- Magic number stamped on every order, so this EA only manages its own.
input long   InpMagic          = 770077;
//--- Hard ceiling on lot size. A command asking for more is rejected, not clamped.
input double InpMaxLots        = 10.0;
//--- Comma-separated whitelist of tradable symbols. Empty = allow any.
input string InpAllowedSymbols = "XAUUSD";
//--- Max slippage in points for market orders.
input ulong  InpDeviation      = 20;

CTrade trade;

//+------------------------------------------------------------------+
int OnInit()
{
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpDeviation);
   trade.SetTypeFillingBySymbol(_Symbol);

   if(InpIntervalSecs < 1)
   {
      Print("[TeoTrader] InpIntervalSecs must be >= 1");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(!MQLInfoInteger(MQL_TRADE_ALLOWED))
      Print("[TeoTrader] WARNING: algo trading is not allowed — enable it or no orders will fill.");

   PrintFormat("[TeoTrader] polling MQL5/Files/%s/commands every %ds (magic %d)",
               InpBridgeDir, InpIntervalSecs, (int)InpMagic);
   EventSetTimer(InpIntervalSecs);
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("[TeoTrader] stopped");
}

//+------------------------------------------------------------------+
//| Extract one value from a flat JSON object. Handles a quoted       |
//| string or a bare number/bool. Good enough for the small, machine- |
//| generated commands this bridge uses — not a general JSON parser.  |
//+------------------------------------------------------------------+
string JsonValue(const string json, const string key)
{
   string pat = "\"" + key + "\"";
   int p = StringFind(json, pat);
   if(p < 0) return "";
   p = StringFind(json, ":", p + StringLen(pat));
   if(p < 0) return "";
   p++;
   int len = StringLen(json);
   while(p < len)
   {
      ushort c = StringGetCharacter(json, p);
      if(c == ' ' || c == '\t' || c == '\n' || c == '\r') p++;
      else break;
   }
   if(p >= len) return "";
   if(StringGetCharacter(json, p) == '"')
   {
      p++;
      int e = StringFind(json, "\"", p);
      if(e < 0) return "";
      return StringSubstr(json, p, e - p);
   }
   int e = p;
   while(e < len)
   {
      ushort c = StringGetCharacter(json, e);
      if(c == ',' || c == '}' || c == ' ' || c == '\n' || c == '\r' || c == '\t') break;
      e++;
   }
   return StringSubstr(json, p, e - p);
}

//+------------------------------------------------------------------+
bool SymbolAllowed(const string symbol)
{
   string list = InpAllowedSymbols;
   StringTrimLeft(list);
   StringTrimRight(list);
   if(StringLen(list) == 0) return true;
   string parts[];
   int n = StringSplit(list, ',', parts);
   for(int i = 0; i < n; i++)
   {
      string p = parts[i];
      StringTrimLeft(p);
      StringTrimRight(p);
      if(p == symbol) return true;
   }
   return false;
}

//+------------------------------------------------------------------+
//| Read a whole file from the sandbox into a string.                 |
//+------------------------------------------------------------------+
bool ReadFileText(const string path, string &out)
{
   int h = FileOpen(path, FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) return false;
   out = "";
   while(!FileIsEnding(h))
      out += FileReadString(h);
   FileClose(h);
   return true;
}

//+------------------------------------------------------------------+
void WriteResponse(const string clientId, bool ok, long ticket,
                   double price, const string err)
{
   string path = InpBridgeDir + "\\responses\\" + clientId + ".json";
   int h = FileOpen(path, FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE)
   {
      PrintFormat("[TeoTrader] cannot write response %s (error %d)", path, GetLastError());
      return;
   }
   // Escape backslashes/quotes in the error text so the JSON stays valid.
   string safeErr = err;
   StringReplace(safeErr, "\\", "\\\\");
   StringReplace(safeErr, "\"", "\\\"");
   FileWriteString(h, StringFormat(
      "{\"clientId\":\"%s\",\"ok\":%s,\"ticket\":%d,\"price\":%.5f,\"error\":\"%s\"}",
      clientId, (ok ? "true" : "false"), (int)ticket, price, safeErr));
   FileClose(h);
}

//+------------------------------------------------------------------+
//| Act on one command file. Returns nothing; always writes a         |
//| response and always deletes the command afterwards.               |
//+------------------------------------------------------------------+
void ProcessCommand(const string fileName)
{
   string cmdPath = InpBridgeDir + "\\commands\\" + fileName;

   string json;
   if(!ReadFileText(cmdPath, json))
   {
      PrintFormat("[TeoTrader] cannot read %s (error %d)", cmdPath, GetLastError());
      return;
   }

   string clientId = JsonValue(json, "clientId");
   if(StringLen(clientId) == 0)
   {
      PrintFormat("[TeoTrader] command %s has no clientId — deleting", fileName);
      FileDelete(cmdPath);
      return;
   }

   // Idempotency: if a response already exists, this command was handled.
   string respPath = InpBridgeDir + "\\responses\\" + clientId + ".json";
   if(FileIsExist(respPath))
   {
      FileDelete(cmdPath);
      return;
   }

   string action = JsonValue(json, "action");
   string symbol = JsonValue(json, "symbol");

   if(!SymbolAllowed(symbol))
   {
      WriteResponse(clientId, false, 0, 0, "symbol not allowed: " + symbol);
      FileDelete(cmdPath);
      return;
   }
   if(!SymbolSelect(symbol, true))
   {
      WriteResponse(clientId, false, 0, 0, "symbol not available: " + symbol);
      FileDelete(cmdPath);
      return;
   }

   if(action == "OPEN")
   {
      string side = JsonValue(json, "side");
      double lots = StringToDouble(JsonValue(json, "lots"));
      double sl   = StringToDouble(JsonValue(json, "sl"));
      double tp   = StringToDouble(JsonValue(json, "tp"));
      string comment = JsonValue(json, "comment");

      if(lots <= 0 || lots > InpMaxLots)
      {
         WriteResponse(clientId, false, 0, 0,
                       StringFormat("lots %.2f out of range (max %.2f)", lots, InpMaxLots));
         FileDelete(cmdPath);
         return;
      }

      bool ok;
      if(side == "BUY")
         ok = trade.Buy(lots, symbol, 0.0, sl, tp, comment);
      else if(side == "SELL")
         ok = trade.Sell(lots, symbol, 0.0, sl, tp, comment);
      else
      {
         WriteResponse(clientId, false, 0, 0, "unknown side: " + side);
         FileDelete(cmdPath);
         return;
      }

      if(ok && trade.ResultRetcode() == TRADE_RETCODE_DONE)
         WriteResponse(clientId, true, (long)trade.ResultOrder(),
                       trade.ResultPrice(), "");
      else
         WriteResponse(clientId, false, 0, 0,
                       StringFormat("retcode %d: %s",
                                    trade.ResultRetcode(),
                                    trade.ResultRetcodeDescription()));
      FileDelete(cmdPath);
      return;
   }

   if(action == "CLOSE")
   {
      long ticket = (long)StringToInteger(JsonValue(json, "ticket"));
      if(ticket <= 0)
      {
         WriteResponse(clientId, false, 0, 0, "close: missing ticket");
         FileDelete(cmdPath);
         return;
      }
      // The dashboard passes the position ticket returned at open time.
      bool ok = trade.PositionClose((ulong)ticket);
      if(ok && (trade.ResultRetcode() == TRADE_RETCODE_DONE ||
                trade.ResultRetcode() == TRADE_RETCODE_DONE_PARTIAL))
         WriteResponse(clientId, true, ticket, trade.ResultPrice(), "");
      else
         WriteResponse(clientId, false, 0, 0,
                       StringFormat("close retcode %d: %s",
                                    trade.ResultRetcode(),
                                    trade.ResultRetcodeDescription()));
      FileDelete(cmdPath);
      return;
   }

   WriteResponse(clientId, false, 0, 0, "unknown action: " + action);
   FileDelete(cmdPath);
}

//+------------------------------------------------------------------+
void OnTimer()
{
   string pattern = InpBridgeDir + "\\commands\\*.json";
   string file;
   long handle = FileFindFirst(pattern, file);
   if(handle == INVALID_HANDLE) return;

   // Collect first, then process: acting while the find handle is open on the
   // same directory is not reliable across platforms.
   string files[];
   int count = 0;
   do
   {
      // Skip the *.json.tmp files the server renames from — belt and braces,
      // the pattern already excludes them, but a stray one must never be read.
      if(StringFind(file, ".tmp") < 0)
      {
         ArrayResize(files, count + 1);
         files[count] = file;
         count++;
      }
   }
   while(FileFindNext(handle, file));
   FileFindClose(handle);

   for(int i = 0; i < count; i++)
      ProcessCommand(files[i]);
}
//+------------------------------------------------------------------+
