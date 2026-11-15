package com.velnox.core.common.extensions

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * Extension functions for common operations across the Velnox Android apps.
 */

// CoroutineScope extensions
fun CoroutineScope.launchSupervised(block: suspend CoroutineScope.() -> Unit): Job {
    return launch {
        supervisorScope { block() }
    }
}

fun ViewModel.launchInViewModel(block: suspend CoroutineScope.() -> Unit): Job {
    return viewModelScope.launchSupervised(block)
}

// Flow extensions
fun <T> StateFlow<T>.distinctUntilChanged(): StateFlow<T> =
    this.distinctUntilChanged()

// StateFlow factory
fun <T> MutableStateFlow(value: T): MutableStateFlow<T> = MutableStateFlow(value)

// Compose state delegation
@Composable
fun <T> rememberMutableStateFlow(initialValue: T): MutableStateFlow<T> {
    return remember { MutableStateFlow(initialValue) }
}

// Result extensions
import com.velnox.core.common.result.Result
import com.velnox.core.common.result.Error

inline fun <T> Result<T>.onSuccess(action: (T) -> Unit): Result<T> {
    if (this is Result.Success) {
        action(this.data)
    }
    return this
}

inline fun <T> Result<T>.onFailure(action: (Error) -> Unit): Result<T> {
    if (this is Result.Failure) {
        action(this.error)
    }
    return this
}

inline fun <T, R> Result<T>.map(transform: (T) -> R): Result<R> {
    return when (this) {
        is Result.Success -> Result.Success(transform(data))
        is Result.Failure -> this
    }
}

inline fun <T, R> Result<T>.flatMap(transform: (T) -> Result<R>): Result<R> {
    return when (this) {
        is Result.Success -> transform(data)
        is Result.Failure -> this
    }
}

// String extensions
fun String?.isNullOrBlank(): Boolean = this == null || this.isBlank()

fun String.toIntOrNull(): Int? = this.toIntOrNull()

// Throwable extensions
fun Throwable.messageOrClassName(): String = message ?: this::class.simpleName

// Collection extensions
fun <T> List<T>.isNullOrEmpty(): Boolean = this.isNullOrEmpty()
