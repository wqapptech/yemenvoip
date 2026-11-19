# Partner SMS bridge (outbound: SIP MESSAGE -> GSM via gateway)

Sends an SMS out through a SIM when the partner extension (2001) sends a SIP
MESSAGE. Replies (inbound) are a separate step — see "Next".

## Flow
Partner (ext 2001) --SIP MESSAGE--> Asterisk [partner-sms] --AGI--> goip_post_sms.html --> SIM sends SMS

## Install on the FreePBX box
1. Copy the AGI script and make it runnable:
   sudo cp agi-bin/gw_sendsms.py /var/lib/asterisk/agi-bin/
   sudo chown asterisk:asterisk /var/lib/asterisk/agi-bin/gw_sendsms.py
   sudo chmod 755 /var/lib/asterisk/agi-bin/gw_sendsms.py

2. Append the dialplan snippet to the custom dialplan:
   cat extensions_custom.conf.snippet | sudo tee -a /etc/asterisk/extensions_custom.conf

3. Append the PJSIP snippet (attaches message_context to 2001):
   cat pjsip.endpoint_custom_post.conf.snippet | sudo tee -a /etc/asterisk/pjsip.endpoint_custom_post.conf

4. Set the partner's SIM PORT: edit the AGI arg in extensions_custom.conf
   ([partner-sms] -> `AGI(gw_sendsms.py,<PORT>,${EXTEN})`), replacing 29.

5. Apply:
   sudo fwconsole reload

## Test
From Zoiper logged in as 2001 (or the partner's client), send a chat/SMS to a
mobile number. Watch it fire:
   sudo tail -f /var/log/asterisk/full | grep gw_sendsms
The gateway reply (`status":"0 OK"`) means it was accepted.

## Notes / Next
- Gateway creds are read from /opt/sim-collector/collector.env (not in dialplan).
- The message body is read via AGI GET VARIABLE, so commas/quotes in the text are safe.
- INBOUND replies (GSM SMS -> back to 2001 in the client) are the next piece:
  the gateway SMS-forward (or the collector's sms poll) injects the message into
  Asterisk with MessageSend(PJSIP/2001). Build after outbound is confirmed.
