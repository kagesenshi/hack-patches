/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

/*
 * Pidgin GnomeShell Integration.
 *
 * Credits to the author of Gajim extension as this extension code was modified
 * from it.
 *
 */

const DBus = imports.dbus;
const Gettext = imports.gettext.domain('gnome-shell');
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Signals = imports.signals;
const St = imports.gi.St;
const Tp = imports.gi.TelepathyGLib;

const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const MessageTray = imports.ui.messageTray;
const Shell = imports.gi.Shell;
const TelepathyClient = imports.ui.telepathyClient;

const _ = Gettext.gettext;

function wrappedText(text, sender, timestamp, direction) {
    return {
        messageType: Tp.ChannelTextMessageType.NORMAL,
        text: text,
        sender: sender,
        timestamp: timestamp,
        direction: direction
    };
}

function Source(client, account, author, initialMessage, conversation) {
    this._init(client, account, author, initialMessage, conversation);
}

Source.prototype = {
    __proto__: MessageTray.Source.prototype,

    _init: function(client, account, author, initialMessage, conversation) {
        MessageTray.Source.prototype._init.call(this, author);
        this.isChat = true;
        this._author = author;
        this._client = client;

        let proxy = this._client.proxy();

        this._account = account;
        this._conversation = conversation;
        this._initialMessage = initialMessage;
        this._iconUri = null;
        this._presence = 'online';
        this._notification = new TelepathyClient.Notification(this);
        this._notification.setUrgency(MessageTray.Urgency.HIGH);
        
        this._iconUri = 'file://' + proxy.PurpleBuddyIconGetFullPathSync(proxy.PurpleConvImGetIconSync(proxy.PurpleConvImSync(this._conversation)));

        global.log(this._iconUri);

        this._buddyStatusChangeId = proxy.connect('BuddyStatusChanged', Lang.bind(this, this._onBuddyStatusChange));
        this._buddySignedOffId = proxy.connect('BuddySignedOff', Lang.bind(this, this._onBuddySignedOff));
        this._deleteConversationId = proxy.connect('DeletingConversation', Lang.bind(this, this._onDeleteConversation));
        this._messageSentId = proxy.connect('SentImMsg', Lang.bind(this, this._onSentImMessage));
        this._messageReceivedId = proxy.connect('ReceivedImMsg', Lang.bind(this, this._onReceivedImMessage));


        // Start!
        //

        this.title = proxy.PurpleConversationGetNameSync(this._conversation);

        this._setSummaryIcon(this.createNotificationIcon());
        let message = wrappedText(this._initialMessage, this._author, null, TelepathyClient.NotificationDirection.RECEIVED);
        this._notification.appendMessage(message, false);
        if (!Main.messageTray.contains(this))
            Main.messageTray.add(this);

        this.notify(this._notification);

    },

    destroy: function () {
        let proxy = this._client.proxy();
        proxy.disconnect(this._buddyStatusChangeId);
        proxy.disconnect(this._buddySignedOffId);
        proxy.disconnect(this._deleteConversationId);
        proxy.disconnect(this._messageSentId);
        proxy.disconnect(this._messageReceivedId);
        MessageTray.Source.prototype.destroy.call(this);
    },
    

    createNotificationIcon: function() {
        let iconBox = new St.Bin({ style_class: 'avatar-box' });
        iconBox._size = this.ICON_SIZE;

        if (!this._iconUri) {
            iconBox.child = new St.Icon({ icon_name: 'avatar-default',
                                          icon_type: St.IconType.FULLCOLOR,
                                          icon_size: iconBox._size });
        } else {
            let textureCache = St.TextureCache.get_default();
            iconBox.child = textureCache.load_uri_async(this._iconUri, iconBox._size, iconBox._size);
        }
        return iconBox;
    },

    open: function(notification) {
        // Lookup for the messages window and display it. In the case where it's not o
        // opened yet fallback to the roster window.
        let windows = global.get_window_actors();
        for (let i = 0; i < windows.length; i++) {
            let metaWindow = windows[i].metaWindow;
            if (metaWindow.get_wm_class_instance() == "pidgin" &&
                metaWindow.get_role() == "messages") {
                Main.activateWindow(metaWindow);
                return;
            }
        }

        let app = Shell.AppSystem.get_default().get_app('pidgin.desktop');
        app.activate_window(null, global.get_current_time());
    },


    notify: function () {
        MessageTray.Source.prototype.notify.call(this, this._notification);
    },


    respond: function(text) {
        proxy = this._client.proxy();
        proxy.PurpleConvImSendRemote(proxy.PurpleConvImSync(this._conversation), text);
    },

    _onBuddyStatusChange: function (emitter, buddy, old_status_id, new_status_id) {
        if (!this.title) return;

        let proxy = this._client.proxy();
        let buddy_alias = proxy.PurpleBuddyGetAliasSync(buddy);

        if (buddy_alias != this._author) return;

        // XXX: this looks wrong. should get string?
        let old_status = proxy.PurpleStatusGetIdSync(old_status_id);
        let new_status = proxy.PurpleStatusGetIdSync(new_status_id);

        this._presence = new_status;
        this._notification.appendPresence(new_status, false);

    },

    _onBuddySignedOff: function(emitter, buddy) {
        let buddy_alias = proxy.PurpleBuddyGetAliasSync(buddy);
        if (buddy_alias != this._author) return;

        this._presence = 'offline';
        this._notification.appendPresence('offline', false);
    },

    _onDeleteConversation: function(emitter, conversation) {
        if (conversation != this._conversation) return;
        this.destroy();
    },


    _onSentImMessage: function(emitter, account, author, text) {

        let buddy = proxy.PurpleFindBuddySync(account, author);
        if (buddy) {
            author = proxy.PurpleBuddyGetAliasSync(buddy);
        }

        if (text && (author == this._author)) {
            let message = wrappedText(text, this._author, null, TelepathyClient.NotificationDirection.SENT);
            this._notification.appendMessage(message, false);
        }

    },

    _onReceivedImMessage: function(emitter, account, author, text) {

        let buddy = proxy.PurpleFindBuddySync(account, author);
        if (buddy) {
            author = proxy.PurpleBuddyGetAliasSync(buddy);
        }

        if (text && (author == this._author)) {
            let message = wrappedText(text, this._author, null, TelepathyClient.NotificationDirection.RECEIVED);
            this._notification.appendMessage(message, false);
            this.notify(this._notification);
        }

    }

}

const PidginIface = {
    name: 'im.pidgin.purple.PurpleInterface',
    properties: [],
    methods: [
        {name: 'PurpleGetIms', inSignature: '', outSignature: 'ai'},
        {name: 'PurpleAccountsGetAllActive', inSignature: '', outSignature: 'ai'},
        {name: 'PurpleFindBuddies', inSignature: 'is', outSignature: 'ai'},
        {name: 'PurpleFindBuddy', inSignature: 'is', outSignature: 'i'},
        {name: 'PurpleAccountGetAlias', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleAccountGetNameForDisplay', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleBuddyGetAlias', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleBuddyGetName', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleStatusGetId', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleBuddyIconGetFullPath', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleConvImSend', inSignature: 'is', outSignature: ''},
        {name: 'PurpleConvIm', inSignature: 'i', outSignature: 'i'},
        {name: 'PurpleConvImGetIcon', inSignature: 'i', outSignature: 'i'},
        {name: 'PurpleConversationGetName', inSignature: 'i', outSignature: 's'}
    ],
    signals: [
        {name: 'ReceivedImMsg', inSignature: 'issiu'},
        {name: 'SentImMsg', inSignature: 'iss'},
        {name: 'BuddyStatusChanged', inSignature: 'iii'}, // ????
        {name: 'BuddySignedOff', inSignature: 'i'},
        {name: 'BuddySignedOn', inSignature: 'i'},
        {name: 'DeletingConversation', inSignature: 'i'}
    ]
};

let Pidgin = DBus.makeProxyClass(PidginIface);

function patchSynchronousMethods(obj, iface) {
    if ('methods' in iface) {
        let methods = iface.methods;

        for (let i = 0; i < methods.length; ++i) {
            let method = methods[i];

            if (!('name' in method))
                throw new Error("Method definition must have a name");

            if (!('outSignature' in method))
                method.outSignature = "a{sv}";

            if (!("inSignature" in method))
                method.inSignature = "a{sv}";

            if (!("timeout" in method))
                method.timeout = -1;

            let name = method.name + 'Sync';
            obj[name] = function () {
                let arg_array = Array.prototype.slice.call(arguments);
                log('calling ' + method.name + ' with parameters ' + arg_array + ' arguments ' + 
                    arguments); 
                return obj._dbusBus.call(
                    obj._dbusBusName,
                    obj._dbusPath,
                    obj._dbusInterface,
                    method.name,
                    method.outSignature,
                    method.inSignature,
                    false,
                    1000,
                    arg_array || []
                );
            }
        }
    }
    return obj;
}

function PidginClient() {
    this._init();
}

PidginClient.prototype = {
    _init: function() {
        this._sources = {};
        this._proxy = new Pidgin(DBus.session, 'im.pidgin.purple.PurpleService', '/im/pidgin/purple/PurpleObject');
        patchSynchronousMethods(this._proxy, PidginIface);
        this._proxy.connect('ReceivedImMsg', Lang.bind(this, this._messageReceived));
    },

    proxy: function () {
        return this._proxy;
    },

    _messageReceived: function(emitter, account, author, message, conversation) {
        let proxy = this.proxy()

        let buddy = proxy.PurpleFindBuddySync(account, author);
        if (buddy) {
            author = proxy.PurpleBuddyGetAliasSync(buddy);
        }

        let source = this._sources[author];
        if (!source) {
            source = new Source(this, account, author, message, conversation);
            source.connect('destroy', Lang.bind(this, 
                function() {
                    delete this._sources[author];
                }
            ));
            this._sources[author] = source;
        }
    }
}


function main() {
    let client = new PidginClient();
}
