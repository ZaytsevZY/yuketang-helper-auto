package com.zaytsev.yuketanghelper

import android.app.Application
import com.zaytsev.yuketanghelper.session.ClassroomSession

class HelperApplication : Application() {
    val session: ClassroomSession by lazy { ClassroomSession(this) }
}
