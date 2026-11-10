package services

import "github.com/wailsapp/wails/v3/pkg/application"

func LogDataMiddleware(s *LogService) application.Middleware {
	return s.data.Middleware
}
