{{/*
Expand the name of the chart.
*/}}
{{- define "nimiq-simple-faucet.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "nimiq-simple-faucet.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Chart name and version as used by the chart label.
*/}}
{{- define "nimiq-simple-faucet.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Common labels.
*/}}
{{- define "nimiq-simple-faucet.labels" -}}
helm.sh/chart: {{ include "nimiq-simple-faucet.chart" . }}
{{ include "nimiq-simple-faucet.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: nimiq-simple-faucet
{{- end -}}

{{/*
Selector labels.
*/}}
{{- define "nimiq-simple-faucet.selectorLabels" -}}
app.kubernetes.io/name: {{ include "nimiq-simple-faucet.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
Name of the service account to use.
*/}}
{{- define "nimiq-simple-faucet.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "nimiq-simple-faucet.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
The image tag to use (falls back to appVersion).
*/}}
{{- define "nimiq-simple-faucet.imageTag" -}}
{{- default .Chart.AppVersion .Values.image.tag -}}
{{- end -}}

{{/*
Name of the Secret used by the pod (either rendered inline or produced by ESO).
*/}}
{{- define "nimiq-simple-faucet.secretName" -}}
{{- printf "%s-env" (include "nimiq-simple-faucet.fullname" .) -}}
{{- end -}}

{{/*
Are we running in SQLite mode (no postgres subchart)?
*/}}
{{- define "nimiq-simple-faucet.sqliteMode" -}}
{{- if and .Values.persistence.enabled (not .Values.postgresql.enabled) -}}
true
{{- else -}}
false
{{- end -}}
{{- end -}}
