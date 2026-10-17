package xyz.viosarcade.crystalienconflict;

import android.app.Activity;
import android.content.Context;
import android.content.pm.ActivityInfo;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// The screen's way round, the player's setting (src/online/android.js): held sideways
// ("landscape", the first time), upright ("portrait") -- either way up, as the phone is turned
// -- or turning with the phone ("auto", as its own rotation setting allows).  Kept on the phone,
// so that the app opens the chosen way round (MainActivity).
@CapacitorPlugin(name = "Orientation")
public class OrientationPlugin extends Plugin {
    private static final String PREFS = "orientation";

    static int request(String mode) {
        if ("portrait".equals(mode)) return ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT;
        if ("auto".equals(mode)) return ActivityInfo.SCREEN_ORIENTATION_FULL_USER;
        return ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
    }

    static String saved(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("mode", "landscape");
    }

    static void apply(Activity activity) {
        activity.setRequestedOrientation(request(saved(activity)));
    }

    @PluginMethod
    public void set(PluginCall call) {
        String mode = call.getString("mode", "landscape");
        if (!"portrait".equals(mode) && !"auto".equals(mode)) mode = "landscape";
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("mode", mode).apply();
        Activity activity = getActivity();
        final String chosen = mode;
        activity.runOnUiThread(() -> activity.setRequestedOrientation(request(chosen)));
        JSObject ret = new JSObject();
        ret.put("mode", mode);
        call.resolve(ret);
    }
}
