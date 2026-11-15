package com.velnox.core.designsystem.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExposedDropdownMenu
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.MenuItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.velnox.core.designsystem.tokens.VelnoxColors
import com.velnox.core.designsystem.tokens.VelnoxIcons
import com.velnox.core.designsystem.tokens.VelnoxShapes
import com.velnox.core.designsystem.tokens.VelnoxSpacing
import com.velnox.core.designsystem.tokens.VelnoxTypography

/**
 * Velnox Input Components
 * Mapped from VELNOX_DESIGN_THEME.md v2.2
 * Input: rounded-squircle (14px)
 */

/**
 * Standard outlined text field
 */
@Composable
fun VelnoxTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
    isError: Boolean = false,
    errorMessage: String? = null,
    isEnabled: Boolean = true,
    isReadOnly: Boolean = false,
    singleLine: Boolean = true,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    maxLines: Int = 1,
    modifierWeight: Boolean = false
) {
    val colors = TextFieldDefaults.textFieldColors(
        containerColor = VelnoxColors.Surface,
        disabledContainerColor = VelnoxColors.SurfaceVariant.copy(alpha = 0.5f),
        focusedContainerColor = VelnoxColors.Surface,
        unfocusedContainerColor = VelnoxColors.Surface,
        errorContainerColor = VelnoxColors.ErrorContainer,
        labelColor = VelnoxColors.OnSurface.copy(alpha = 0.6f),
        placeholderColor = VelnoxColors.OnSurface.copy(alpha = 0.4f),
        inputColor = VelnoxColors.OnSurface,
        disabledInputColor = VelnoxColors.OnSurface.copy(alpha = 0.38f),
        cursorColor = VelnoxColors.Secondary,
        focusedLabelColor = VelnoxColors.Secondary,
        unfocusedLabelColor = VelnoxColors.OnSurface.copy(alpha = 0.6f),
        disabledLabelColor = VelnoxColors.OnSurface.copy(alpha = 0.38f),
        errorLabelColor = VelnoxColors.Error,
        focusedIndicatorColor = VelnoxColors.Secondary,
        unfocusedIndicatorColor = VelnoxColors.Outline,
        disabledIndicatorColor = VelnoxColors.Outline.copy(alpha = 0.5f),
        errorIndicatorColor = VelnoxColors.Error,
        focusedIconColor = VelnoxColors.Secondary,
        unfocusedIconColor = VelnoxColors.OnSurface.copy(alpha = 0.4f),
        disabledIconColor = VelnoxColors.OnSurface.copy(alpha = 0.38f)
    )

    val modifierWithFill = if (modifierWeight) modifier.fillMaxWidth() else modifier

    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifierWithFill
            .padding(vertical = VelnoxSpacing.xs),
        label = label?.let { { Text(text = it, style = VelnoxTypography.bodyMedium) } },
        placeholder = placeholder?.let { { Text(text = it, style = VelnoxTypography.bodyMedium) } },
        leadingIcon = leadingIcon?.let { { it() } },
        trailingIcon = trailingIcon?.let { { it() } },
        isError = isError,
        singleLine = singleLine,
        maxLines = maxLines,
        enabled = isEnabled,
        readOnly = isReadOnly,
        keyboardOptions = keyboardOptions,
        visualTransformation = visualTransformation,
        shape = VelnoxShapes.input,
        colors = colors,
        textStyle = VelnoxTypography.bodyMedium
    )

    if (isError && errorMessage != null) {
        Text(
            text = errorMessage,
            style = VelnoxTypography.caption,
            color = VelnoxColors.Error,
            modifier = Modifier.padding(start = VelnoxSpacing.inputPaddingHorizontal, top = VelnoxSpacing.xxs)
        )
    }
}

/**
 * Password text field with visibility toggle
 */
@Composable
fun VelnoxPasswordField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = "Password",
    placeholder: String? = "Enter password",
    isError: Boolean = false,
    errorMessage: String? = null,
    isEnabled: Boolean = true
) {
    var passwordVisible by remember { mutableStateOf(false) }
    var keyboardOptions = KeyboardOptions.Default
        .copy(keyboardType = KeyboardType.Password)

    VelnoxTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier,
        label = label,
        placeholder = placeholder,
        leadingIcon = { Icon(imageVector = androidx.compose.material.icons.outlined.Lock, contentDescription = "Password") },
        trailingIcon = {
            Icon(
                imageVector = if (passwordVisible) {
                    androidx.compose.material.icons.outlined.VisibilityOff
                } else {
                    androidx.compose.material.icons.outlined.Visibility
                },
                contentDescription = if (passwordVisible) "Hide password" else "Show password",
                tint = VelnoxColors.OnSurface.copy(alpha = 0.5f),
                modifier = Modifier
                    .fillMaxSize()
                    .wrapContentSize()
                    .padding(end = VelnoxSpacing.xs)
                    .onClick { passwordVisible = !passwordVisible }
            },
        isError = isError,
        errorMessage = errorMessage,
        isEnabled = isEnabled,
        visualTransformation = if (passwordVisible) VisualTransformation.None else androidx.compose.foundation.text.PasswordVisualTransformation(),
        keyboardOptions = keyboardOptions
    )
}

/**
 * Search input field
 */
@Composable
fun VelnoxSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "Search products...",
    onSearchClick: (() -> Unit)? = null,
    leadingIcon: (@Composable () -> Unit)? = null
) {
    VelnoxTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = VelnoxSpacing.xs),
        placeholder = placeholder,
        leadingIcon = leadingIcon ?: { Icon(imageVector = androidx.compose.material.icons.outlined.Search, contentDescription = "Search") },
        trailingIcon = onSearchClick?.let { { Icon(imageVector = androidx.compose.material.icons.outlined.Send, contentDescription = "Search", tint = VelnoxColors.Secondary, modifier = Modifier.fillMaxSize().wrapContentSize().padding(end = VelnoxSpacing.xs).onClick(it)) } },
        singleLine = true,
        keyboardOptions = KeyboardOptions.Default.copy(keyboardType = KeyboardType.Text, imeAction = androidx.compose.ui.text.input.ImeAction.Search)
    )
}

/**
 * Dropdown/Exposed dropdown menu
 */
@Composable
fun VelnoxDropdownMenu<T>(
    modifier: Modifier = Modifier,
    options: List<T>,
    selectedOption: T?,
    onOptionClick: (T) -> Unit,
    optionLabel: (T) -> String,
    placeholder: String = "Select an option",
    label: String? = null,
    isError: Boolean = false,
    errorMessage: String? = null,
    isEnabled: Boolean = true,
    leadingIcon: (@Composable () -> Unit)? = null
) {
    var expanded by remember { mutableStateOf(false) }

    val colors = TextFieldDefaults.textFieldColors(
        containerColor = VelnoxColors.Surface,
        disabledContainerColor = VelnoxColors.SurfaceVariant.copy(alpha = 0.5f),
        focusedContainerColor = VelnoxColors.Surface,
        unfocusedContainerColor = VelnoxColors.Surface,
        errorContainerColor = VelnoxColors.ErrorContainer,
        labelColor = VelnoxColors.OnSurface.copy(alpha = 0.6f),
        placeholderColor = VelnoxColors.OnSurface.copy(alpha = 0.4f),
        inputColor = VelnoxColors.OnSurface,
        disabledInputColor = VelnoxColors.OnSurface.copy(alpha = 0.38f),
        cursorColor = VelnoxColors.Secondary,
        focusedLabelColor = VelnoxColors.Secondary,
        unfocusedLabelColor = VelnoxColors.OnSurface.copy(alpha = 0.6f),
        disabledLabelColor = VelnoxColors.OnSurface.copy(alpha = 0.38f),
        errorLabelColor = VelnoxColors.Error,
        focusedIndicatorColor = VelnoxColors.Secondary,
        unfocusedIndicatorColor = VelnoxColors.Outline,
        disabledIndicatorColor = VelnoxColors.Outline.copy(alpha = 0.5f),
        errorIndicatorColor = VelnoxColors.Error,
        focusedIconColor = VelnoxColors.Secondary,
        unfocusedIconColor = VelnoxColors.OnSurface.copy(alpha = 0.4f),
        disabledIconColor = VelnoxColors.OnSurface.copy(alpha = 0.38f)
    )

    ExposedDropdownMenuBox(
        modifier = modifier.fillMaxWidth(),
        expanded = expanded,
        onExpandedChange = { expanded = !expanded && isEnabled }
    ) {
        androidx.compose.material3.TextField(
            value = selectedOption?.let(optionLabel) ?: "",
            onValueChange = {},
            label = label?.let { { Text(text = it, style = VelnoxTypography.bodyMedium) } },
            placeholder = { Text(text = placeholder, style = VelnoxTypography.bodyMedium) },
            leadingIcon = leadingIcon?.let { { it() } },
            trailingIcon = {
                Icon(
                    imageVector = if (expanded) {
                        androidx.compose.material.icons.outlined.ExpandLess
                    } else {
                        androidx.compose.material.icons.outlined.ExpandMore
                    },
                    contentDescription = "Dropdown",
                    tint = VelnoxColors.OnSurface.copy(alpha = 0.5f)
                )
            },
            readOnly = true,
            enabled = isEnabled,
            singleLine = true,
            colors = colors,
            shape = VelnoxShapes.input,
            textStyle = VelnoxTypography.bodyMedium,
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = VelnoxSpacing.xs)
                .onClick { if (isEnabled) expanded = !expanded }
        )

        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier.fillMaxWidth()
        ) {
            options.forEach { option ->
                MenuItem(
                    text = { Text(text = optionLabel(option), style = VelnoxTypography.bodyMedium) },
                    onClick = {
                        onOptionClick(option)
                        expanded = false
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = isEnabled,
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(
                        horizontal = VelnoxSpacing.inputPaddingHorizontal,
                        vertical = VelnoxSpacing.inputPaddingVertical
                    )
                )
            }
        }
    }

    if (isError && errorMessage != null) {
        Text(
            text = errorMessage,
            style = VelnoxTypography.caption,
            color = VelnoxColors.Error,
            modifier = Modifier.padding(start = VelnoxSpacing.inputPaddingHorizontal, top = VelnoxSpacing.xxs)
        )
    }
}

/**
 * Text area for multi-line input
 */
@Composable
fun VelnoxTextArea(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    isError: Boolean = false,
    errorMessage: String? = null,
    isEnabled: Boolean = true,
    minLines: Int = 4,
    maxLines: Int = 8
) {
    val colors = TextFieldDefaults.textFieldColors(
        containerColor = VelnoxColors.Surface,
        disabledContainerColor = VelnoxColors.SurfaceVariant.copy(alpha = 0.5f),
        focusedContainerColor = VelnoxColors.Surface,
        unfocusedContainerColor = VelnoxColors.Surface,
        errorContainerColor = VelnoxColors.ErrorContainer,
        labelColor = VelnoxColors.OnSurface.copy(alpha = 0.6f),
        placeholderColor = VelnoxColors.OnSurface.copy(alpha = 0.4f),
        inputColor = VelnoxColors.OnSurface,
        disabledInputColor = VelnoxColors.OnSurface.copy(alpha = 0.38f),
        cursorColor = VelnoxColors.Secondary,
        focusedLabelColor = VelnoxColors.Secondary,
        unfocusedLabelColor = VelnoxColors.OnSurface.copy(alpha = 0.6f),
        disabledLabelColor = VelnoxColors.OnSurface.copy(alpha = 0.38f),
        errorLabelColor = VelnoxColors.Error,
        focusedIndicatorColor = VelnoxColors.Secondary,
        unfocusedIndicatorColor = VelnoxColors.Outline,
        disabledIndicatorColor = VelnoxColors.Outline.copy(alpha = 0.5f),
        errorIndicatorColor = VelnoxColors.Error
    )

    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = VelnoxSpacing.xs),
        label = label?.let { { Text(text = it, style = VelnoxTypography.bodyMedium) } },
        placeholder = placeholder?.let { { Text(text = it, style = VelnoxTypography.bodyMedium) } },
        isError = isError,
        singleLine = false,
        maxLines = maxLines,
        minLines = minLines,
        enabled = isEnabled,
        shape = VelnoxShapes.input,
        colors = colors,
        textStyle = VelnoxTypography.bodyMedium,
        keyboardOptions = KeyboardOptions.Default.copy(keyboardType = KeyboardType.Text)
    )

    if (isError && errorMessage != null) {
        Text(
            text = errorMessage,
            style = VelnoxTypography.caption,
            color = VelnoxColors.Error,
            modifier = Modifier.padding(start = VelnoxSpacing.inputPaddingHorizontal, top = VelnoxSpacing.xxs)
        )
    }
}
