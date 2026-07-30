{{- define "watcher.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "watcher.fullname" -}}
{{- $name := include "watcher.name" . -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "watcher.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" -}}
{{- end -}}

{{- define "watcher.labels" -}}
helm.sh/chart: {{ include "watcher.chart" . }}
{{ include "watcher.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "watcher.selectorLabels" -}}
app.kubernetes.io/name: {{ include "watcher.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "watcher.secretName" -}}
{{- .Values.secret.name -}}
{{- end -}}

{{- define "watcher.image" -}}
{{- $registry := .registry -}}
{{- $name := .name -}}
{{- $tag := .tag -}}
{{- if $registry -}}
{{- printf "%s/%s:%s" $registry $name $tag -}}
{{- else -}}
{{- printf "%s:%s" $name $tag -}}
{{- end -}}
{{- end -}}

{{- define "watcher.api.fullname" -}}
{{- printf "%s-api" (include "watcher.fullname" .) -}}
{{- end -}}

{{- define "watcher.scraper.fullname" -}}
{{- printf "%s-scraper" (include "watcher.fullname" .) -}}
{{- end -}}

{{- define "watcher.web.fullname" -}}
{{- printf "%s-web" (include "watcher.fullname" .) -}}
{{- end -}}

{{- define "watcher.postgresql.fullname" -}}
{{- printf "%s-postgresql" (include "watcher.fullname" .) -}}
{{- end -}}

{{- define "watcher.api.selectorLabels" -}}
{{ include "watcher.selectorLabels" . }}
app.kubernetes.io/component: api
{{- end -}}

{{- define "watcher.scraper.selectorLabels" -}}
{{ include "watcher.selectorLabels" . }}
app.kubernetes.io/component: scraper
{{- end -}}

{{- define "watcher.web.selectorLabels" -}}
{{ include "watcher.selectorLabels" . }}
app.kubernetes.io/component: web
{{- end -}}

{{- define "watcher.postgresql.selectorLabels" -}}
{{ include "watcher.selectorLabels" . }}
app.kubernetes.io/component: postgresql
{{- end -}}

{{- define "watcher.api.image" -}}
{{- include "watcher.image" (dict "registry" .Values.images.registry "name" .Values.images.api "tag" .Values.images.tag) -}}
{{- end -}}

{{- define "watcher.scraper.image" -}}
{{- include "watcher.image" (dict "registry" .Values.images.registry "name" .Values.images.scraper "tag" .Values.images.tag) -}}
{{- end -}}

{{- define "watcher.web.image" -}}
{{- include "watcher.image" (dict "registry" .Values.images.registry "name" .Values.images.web "tag" .Values.images.tag) -}}
{{- end -}}

{{- define "watcher.publicUrl" -}}
{{- if .Values.publicUrl -}}
{{- .Values.publicUrl -}}
{{- else -}}
{{- printf "https://%s" .Values.ingress.host -}}
{{- end -}}
{{- end -}}

{{- define "watcher.databaseUrl" -}}
{{- printf "postgresql://%s:$(POSTGRES_PASSWORD)@%s:5432/%s" .Values.postgresql.user (include "watcher.postgresql.fullname" .) .Values.postgresql.database -}}
{{- end -}}
