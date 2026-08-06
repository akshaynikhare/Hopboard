{{- define "realtimeclipboard-relay.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "realtimeclipboard-relay.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "realtimeclipboard-relay.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "realtimeclipboard-relay.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "realtimeclipboard-relay.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "realtimeclipboard-relay.selectorLabels" -}}
app.kubernetes.io/name: {{ include "realtimeclipboard-relay.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
