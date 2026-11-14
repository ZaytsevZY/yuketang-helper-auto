package com.zaytsev.yuketanghelper.ui

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.*
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.util.AttributeSet
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.annotation.RequiresApi
import com.google.android.material.button.MaterialButton

/** Native glass chrome over a soft decorative colour field. Text is never fed into the shader.
 * API 33+ refracts that colour field; earlier/software renderers use the same light palette and rim.
 * No frame loop, window screenshots, WebView capture, or per-frame bitmap allocation is involved.
 */
class GlassDrawable(
    private val host: View?, private val radiusDp: Float = 24f,
    private val accent: Float = 0f, private val dropdown: Boolean = false,
    private val forceFallback: Boolean = false,
) : Drawable() {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val rim = Paint(Paint.ANTI_ALIAS_FLAG)
    private val rect = RectF()
    private val position = IntArray(2)
    private var opacity = 255
    private var pressed = false
    private var focused = false
    private var enabled = true
    private var shader: Shader? = null
    private var shaderFailed = false
    private val density get() = host?.resources?.displayMetrics?.density ?: android.content.res.Resources.getSystem().displayMetrics.density

    override fun onBoundsChange(bounds: Rect) {
        rect.set(bounds.left + density, bounds.top + density, bounds.right - density, bounds.bottom - density)
    }

    override fun isStateful() = true
    override fun onStateChange(state: IntArray): Boolean {
        pressed = android.R.attr.state_pressed in state
        focused = android.R.attr.state_focused in state
        enabled = android.R.attr.state_enabled in state || host == null
        invalidateSelf()
        return true
    }

    override fun draw(canvas: Canvas) {
        if (rect.width() <= 0 || rect.height() <= 0) return
        val radius = minOf(radiusDp * density, rect.height() / 2, rect.width() / 2)
        val tint = if (enabled) accent else 0f
        paint.alpha = if (enabled) opacity else (opacity * 0.55f).toInt()
        paint.style = Paint.Style.FILL
        paint.shader = null
        if (!forceFallback && !shaderFailed && Build.VERSION.SDK_INT >= 33 && canvas.isHardwareAccelerated) {
            try {
                if (shader == null) shader = GlassShader.create()
                host?.getLocationInWindow(position)
                GlassShader.update(shader!!, rect.width(), rect.height(), radius, position[0].toFloat(), position[1].toFloat(), density, tint, pressed)
                paint.shader = shader
            } catch (_: RuntimeException) { shaderFailed = true }
        }
        canvas.save()
        canvas.translate(rect.left, rect.top)
        if (paint.shader == null) {
            paint.shader = LinearGradient(0f, 0f, rect.width(), rect.height(),
                if (tint > 0f) intArrayOf(0xFFF2FFFB.toInt(), 0xFFD2EEE5.toInt(), 0xFFC7E4ED.toInt())
                else intArrayOf(0xFFFDFEFF.toInt(), 0xFFE6F0F5.toInt(), 0xFFE1E8F3.toInt()), null, Shader.TileMode.CLAMP)
        }
        canvas.drawRoundRect(0f, 0f, rect.width(), rect.height(), radius, radius, paint)
        paint.shader = null
        // A light upper rim and cool lower rim give the optical edge depth on every API level.
        rim.style = Paint.Style.STROKE
        rim.strokeWidth = density
        rim.shader = LinearGradient(0f, 0f, 0f, rect.height(),
            intArrayOf(Color.WHITE, 0x88FFFFFF.toInt(), 0x497185A6), null, Shader.TileMode.CLAMP)
        canvas.drawRoundRect(density / 2, density / 2, rect.width() - density / 2, rect.height() - density / 2, radius, radius, rim)
        rim.shader = null
        if (focused) {
            rim.color = GlassUi.accent
            rim.strokeWidth = 2 * density
            canvas.drawRoundRect(density, density, rect.width() - density, rect.height() - density, radius, radius, rim)
        }
        if (dropdown) {
            rim.color = GlassUi.ink
            rim.strokeWidth = 1.7f * density
            rim.strokeCap = Paint.Cap.ROUND
            val x = rect.width() - 23 * density
            val y = rect.height() / 2
            canvas.drawLine(x - 4 * density, y - 2 * density, x, y + 2 * density, rim)
            canvas.drawLine(x, y + 2 * density, x + 4 * density, y - 2 * density, rim)
        }
        canvas.restore()
    }
    override fun getOutline(outline: Outline) {
        outline.setRoundRect(bounds, minOf(radiusDp * density, bounds.height() / 2f))
        outline.alpha = 0.18f
    }
    override fun setAlpha(alpha: Int) { opacity = alpha; invalidateSelf() }
    override fun setColorFilter(colorFilter: ColorFilter?) { paint.colorFilter = colorFilter; invalidateSelf() }
    @Deprecated("Required by Drawable") override fun getOpacity() = PixelFormat.TRANSLUCENT
}

@RequiresApi(33)
private object GlassShader {
    fun create(): Shader = RuntimeShader("""
        uniform float2 size;
        uniform float2 origin;
        uniform float radius;
        uniform float density;
        uniform float accent;
        uniform float pressed;
        half4 main(float2 p) {
            float2 q = abs(p - size * 0.5) - size * 0.5 + radius;
            float distance = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
            float edge = pow(clamp(1.0 + distance / (9.0 * density), 0.0, 1.0), 2.0);
            float2 normal = normalize(p - size * 0.5 + float2(0.001));
            float2 refracted = (p + origin + normal * edge * 16.0 * density) / density;
            float blue = 0.5 + 0.5 * sin(refracted.x * 0.013 + refracted.y * 0.008);
            float mint = 0.5 + 0.5 * cos(refracted.y * 0.012 - refracted.x * 0.006);
            half3 backdrop = mix(half3(0.90,0.95,0.98), half3(0.82,0.90,0.96), blue * 0.55);
            backdrop = mix(backdrop, half3(0.79,0.94,0.89), mint * (0.10 + accent * 0.65));
            float topLight = 1.0 - p.y / max(size.y, 1.0);
            half3 color = mix(backdrop, half3(1.0), 0.32 + topLight * 0.30);
            color += half3(0.08) * edge * topLight;
            color -= half3(0.045, 0.035, 0.015) * edge * (1.0 - topLight);
            color -= half3(0.035) * pressed;
            return half4(clamp(color, 0.0, 1.0), 1.0);
        }
    """.trimIndent())
    fun update(shader: Shader, width: Float, height: Float, radius: Float, x: Float, y: Float, density: Float, accent: Float, pressed: Boolean) {
        (shader as RuntimeShader).apply {
            setFloatUniform("size", width, height); setFloatUniform("origin", x, y)
            setFloatUniform("radius", radius); setFloatUniform("density", density)
            setFloatUniform("accent", accent); setFloatUniform("pressed", if (pressed) 1f else 0f)
        }
    }
}

object GlassUi {
    val ink = Color.rgb(31, 48, 65)
    val secondary = Color.rgb(96, 113, 129)
    val accent = Color.rgb(19, 103, 88)
    fun dp(view: View, value: Int) = (value * view.resources.displayMetrics.density).toInt()
    fun surface(view: View, radius: Float = 24f, tint: Float = 0f, interactive: Boolean = true) {
        val glass = GlassDrawable(view, radius, tint)
        view.background = if (interactive) RippleDrawable(ColorStateList.valueOf(0x181A655B), glass,
            GradientDrawable().apply { cornerRadius = radius * view.resources.displayMetrics.density; setColor(Color.WHITE) }) else glass
        view.elevation = dp(view, 2).toFloat()
    }
    fun button(button: Button, primary: Boolean = false) {
        if (button is MaterialButton) {
            button.insetTop = 0; button.insetBottom = 0
        }
        button.backgroundTintList = null
        button.stateListAnimator = null
        button.isAllCaps = false
        button.textSize = 15f
        button.letterSpacing = 0f
        button.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL))
        button.minHeight = dp(button, 52)
        button.minimumHeight = dp(button, 52)
        button.setPadding(dp(button, 18), dp(button, 12), dp(button, 18), dp(button, 12))
        button.setTextColor(ColorStateList(arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()),
            intArrayOf(0xFF8996A3.toInt(), if (primary) accent else ink)))
        surface(button, 26f, if (primary) 1f else 0f)
    }
    fun spinner(spinner: Spinner, entries: List<String>) {
        spinner.minimumHeight = dp(spinner, 56)
        spinner.backgroundTintList = null
        spinner.background = GlassDrawable(spinner, 22f, dropdown = true)
        spinner.elevation = dp(spinner, 2).toFloat()
        spinner.setPopupBackgroundDrawable(GlassDrawable(null, 20f, forceFallback = true))
        spinner.adapter = object : ArrayAdapter<String>(spinner.context, android.R.layout.simple_spinner_item, entries) {
            private fun text(position: Int, recycled: View?, popup: Boolean): View {
                return (recycled as? TextView ?: TextView(context)).apply {
                    this.text = entries[position]
                    textSize = 15f
                    minHeight = dp(this, 52)
                    gravity = android.view.Gravity.CENTER_VERTICAL
                    setPadding(dp(this, 18), dp(this, 12), dp(this, if (popup) 18 else 44), dp(this, 12))
                    setTextColor(if (popup && position == spinner.selectedItemPosition) accent else ink)
                    setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL))
                    background = if (popup && position == spinner.selectedItemPosition) GlassDrawable(this, 16f, 1f) else null
                }
            }
            override fun getView(position: Int, convertView: View?, parent: ViewGroup) = text(position, convertView, false)
            override fun getDropDownView(position: Int, convertView: View?, parent: ViewGroup) = text(position, convertView, true)
        }
    }
    fun card(view: View, tint: Int = 0xFFFCFDFE.toInt(), radius: Float = 22f) {
        view.background = GradientDrawable().apply {
            setColor(tint); cornerRadius = radius * view.resources.displayMetrics.density
            setStroke(dp(view, 1), 0xDFE3EAF1.toInt())
        }
    }
}

/** Independent pill tabs: unlike a segmented toggle group, every selected tab keeps rounded ends. */
class GlassTabBar @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : LinearLayout(context, attrs) {
    private val listeners = mutableListOf<(GlassTabBar, Int, Boolean) -> Unit>()
    var checkedButtonId = View.NO_ID
        private set
    override fun onFinishInflate() {
        super.onFinishInflate()
        GlassUi.surface(this, 32f, interactive = false)
        for (i in 0 until childCount) {
            val button = getChildAt(i) as MaterialButton
            button.isCheckable = true
            button.insetTop = 0; button.insetBottom = 0
            button.backgroundTintList = null
            button.stateListAnimator = null
            button.iconTint = ColorStateList.valueOf(GlassUi.secondary)
            button.setTextColor(GlassUi.secondary)
            button.setOnClickListener { check(button.id) }
            button.background = null
        }
    }
    fun addOnButtonCheckedListener(listener: (GlassTabBar, Int, Boolean) -> Unit) { listeners.add(listener) }
    fun check(id: Int) {
        val previous = checkedButtonId
        checkedButtonId = id
        for (i in 0 until childCount) {
            val button = getChildAt(i) as MaterialButton
            val selected = button.id == id
            button.isChecked = selected
            button.isSelected = selected
            button.background = RippleDrawable(ColorStateList.valueOf(0x181A655B),
                if (selected) GlassDrawable(button, 26f, 1f) else null,
                GradientDrawable().apply {
                    cornerRadius = 26f * resources.displayMetrics.density
                    setColor(Color.WHITE)
                })
            button.setTextColor(if (selected) GlassUi.accent else GlassUi.secondary)
            button.iconTint = ColorStateList.valueOf(if (selected) GlassUi.accent else GlassUi.secondary)
        }
        if (previous != id && previous != View.NO_ID) listeners.toList().forEach { it(this, previous, false) }
        listeners.toList().forEach { it(this, id, true) }
    }
}
