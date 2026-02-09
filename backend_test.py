import requests
import sys
import json
from datetime import datetime

class TelegramBotAPITester:
    def __init__(self, base_url="https://proxy-checker-app.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []
        self.session = requests.Session()
        self.session.timeout = 30

    def log_test_result(self, name, success, details="", expected_status=200, actual_status=None):
        """Log test results"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name} - PASSED")
            if details:
                print(f"   Details: {details}")
        else:
            self.failed_tests.append(name)
            print(f"❌ {name} - FAILED")
            if details:
                print(f"   Error: {details}")
            if actual_status is not None:
                print(f"   Expected status: {expected_status}, Got: {actual_status}")

    def run_request(self, method, endpoint, expected_status=200, data=None, headers=None):
        """Run a single API request"""
        url = f"{self.api_url}{endpoint}"
        
        # Set up headers
        request_headers = {'Content-Type': 'application/json'}
        if self.token:
            request_headers['Authorization'] = f'Bearer {self.token}'
        if headers:
            request_headers.update(headers)

        try:
            if method == 'GET':
                response = self.session.get(url, headers=request_headers)
            elif method == 'POST':
                response = self.session.post(url, json=data, headers=request_headers)
            elif method == 'DELETE':
                response = self.session.delete(url, json=data, headers=request_headers)
            else:
                return False, {}, f"Unsupported method: {method}"

            success = response.status_code == expected_status
            
            try:
                response_data = response.json() if response.content else {}
            except:
                response_data = {"raw_response": response.text[:200]}

            return success, response_data, response.status_code

        except requests.RequestException as e:
            return False, {}, f"Request failed: {str(e)}"

    def test_login(self):
        """Test authentication with admin credentials"""
        print("\n🔐 Testing Authentication...")
        
        success, response_data, status_code = self.run_request(
            "POST", 
            "/auth/login", 
            200, 
            {"username": "admin", "password": "vpnbot2024"}
        )
        
        if success and "token" in response_data:
            self.token = response_data["token"]
            self.log_test_result("Login API", True, f"Token received: {self.token[:20]}...")
            return True
        else:
            self.log_test_result("Login API", False, f"No token received. Response: {response_data}", 200, status_code)
            return False

    def test_dashboard_stats(self):
        """Test dashboard stats endpoint"""
        print("\n📊 Testing Dashboard Stats...")
        
        success, response_data, status_code = self.run_request("GET", "/dashboard/stats", 200)
        
        expected_fields = ["total_configs", "active_configs", "source_links", "channels", "cache_size", "pending_submissions"]
        missing_fields = [field for field in expected_fields if field not in response_data]
        
        if success and not missing_fields:
            self.log_test_result("Dashboard Stats", True, f"All fields present: {list(response_data.keys())}")
        else:
            error_msg = f"Missing fields: {missing_fields}" if missing_fields else "Request failed"
            self.log_test_result("Dashboard Stats", False, error_msg, 200, status_code)

    def test_source_links_management(self):
        """Test source links CRUD operations"""
        print("\n🔗 Testing Source Links Management...")
        
        # Get current links
        success, response_data, status_code = self.run_request("GET", "/dashboard/links", 200)
        if success:
            initial_links = response_data.get("links", [])
            self.log_test_result("Get Source Links", True, f"Current links count: {len(initial_links)}")
        else:
            self.log_test_result("Get Source Links", False, "Failed to get links", 200, status_code)
            return

        # Add a new link
        test_link = "https://example.com/test-config-source"
        success, response_data, status_code = self.run_request(
            "POST", 
            "/dashboard/links", 
            200, 
            {"url": test_link}
        )
        if success:
            updated_links = response_data.get("links", [])
            if test_link in updated_links:
                self.log_test_result("Add Source Link", True, f"Link added successfully. New count: {len(updated_links)}")
            else:
                self.log_test_result("Add Source Link", False, "Link not found in response after adding")
        else:
            self.log_test_result("Add Source Link", False, "Failed to add link", 200, status_code)

        # Remove the test link
        success, response_data, status_code = self.run_request(
            "DELETE", 
            "/dashboard/links", 
            200, 
            {"url": test_link}
        )
        if success:
            final_links = response_data.get("links", [])
            if test_link not in final_links:
                self.log_test_result("Remove Source Link", True, f"Link removed successfully. Final count: {len(final_links)}")
            else:
                self.log_test_result("Remove Source Link", False, "Link still present after deletion")
        else:
            self.log_test_result("Remove Source Link", False, "Failed to remove link", 200, status_code)

    def test_channels_management(self):
        """Test channels CRUD operations"""
        print("\n📺 Testing Channels Management...")
        
        # Get current channels
        success, response_data, status_code = self.run_request("GET", "/dashboard/channels", 200)
        if success:
            initial_channels = response_data.get("channels", [])
            self.log_test_result("Get Channels", True, f"Current channels count: {len(initial_channels)}")
        else:
            self.log_test_result("Get Channels", False, "Failed to get channels", 200, status_code)
            return

        # Add a new channel
        test_channel = "-1001234567890"
        success, response_data, status_code = self.run_request(
            "POST", 
            "/dashboard/channels", 
            200, 
            {"channel_id": test_channel}
        )
        if success:
            updated_channels = response_data.get("channels", [])
            if test_channel in updated_channels:
                self.log_test_result("Add Channel", True, f"Channel added successfully. New count: {len(updated_channels)}")
            else:
                self.log_test_result("Add Channel", False, "Channel not found in response after adding")
        else:
            self.log_test_result("Add Channel", False, "Failed to add channel", 200, status_code)

        # Remove the test channel
        success, response_data, status_code = self.run_request(
            "DELETE", 
            "/dashboard/channels", 
            200, 
            {"channel_id": test_channel}
        )
        if success:
            final_channels = response_data.get("channels", [])
            if test_channel not in final_channels:
                self.log_test_result("Remove Channel", True, f"Channel removed successfully. Final count: {len(final_channels)}")
            else:
                self.log_test_result("Remove Channel", False, "Channel still present after deletion")
        else:
            self.log_test_result("Remove Channel", False, "Failed to remove channel", 200, status_code)

    def test_configs_list(self):
        """Test configs listing"""
        print("\n🛡️ Testing Configs List...")
        
        success, response_data, status_code = self.run_request("GET", "/dashboard/configs", 200)
        
        if success and "configs" in response_data and "total" in response_data:
            configs_count = len(response_data["configs"])
            total_count = response_data["total"]
            self.log_test_result("Get Configs", True, f"Retrieved {configs_count} configs, Total: {total_count}")
        else:
            self.log_test_result("Get Configs", False, "Missing configs or total field", 200, status_code)

    def test_templates_management(self):
        """Test templates management"""
        print("\n📝 Testing Templates Management...")
        
        # Get current templates
        success, response_data, status_code = self.run_request("GET", "/dashboard/templates", 200)
        if success:
            templates = response_data.get("templates", {})
            self.log_test_result("Get Templates", True, f"Templates retrieved: {list(templates.keys())}")
            
            # Test updating a template
            if templates:
                first_template_type = list(templates.keys())[0]
                test_template = "Test template: {type} - {server} - {status}"
                
                success, response_data, status_code = self.run_request(
                    "POST", 
                    "/dashboard/templates", 
                    200, 
                    {"config_type": first_template_type, "template": test_template}
                )
                if success:
                    updated_templates = response_data.get("templates", {})
                    if updated_templates.get(first_template_type) == test_template:
                        self.log_test_result("Update Template", True, f"Template '{first_template_type}' updated successfully")
                    else:
                        self.log_test_result("Update Template", False, "Template not updated in response")
                else:
                    self.log_test_result("Update Template", False, "Failed to update template", 200, status_code)
        else:
            self.log_test_result("Get Templates", False, "Failed to get templates", 200, status_code)

    def test_submissions(self):
        """Test submissions endpoint"""
        print("\n👥 Testing Submissions...")
        
        success, response_data, status_code = self.run_request("GET", "/dashboard/submissions", 200)
        
        if success and "submissions" in response_data:
            submissions_count = len(response_data["submissions"])
            self.log_test_result("Get Submissions", True, f"Retrieved {submissions_count} pending submissions")
        else:
            self.log_test_result("Get Submissions", False, "Missing submissions field", 200, status_code)

    def test_fetch_now(self):
        """Test fetch-now functionality"""
        print("\n🔄 Testing Fetch Now...")
        
        success, response_data, status_code = self.run_request("POST", "/dashboard/fetch-now", 200)
        
        expected_fields = ["new_configs", "total_checked"]
        missing_fields = [field for field in expected_fields if field not in response_data]
        
        if success and not missing_fields:
            new_configs = response_data.get("new_configs", 0)
            total_checked = response_data.get("total_checked", 0)
            self.log_test_result("Fetch Now", True, f"New configs: {new_configs}, Total checked: {total_checked}")
        else:
            error_msg = f"Missing fields: {missing_fields}" if missing_fields else "Request failed"
            self.log_test_result("Fetch Now", False, error_msg, 200, status_code)

    def test_config_testing(self):
        """Test config testing functionality"""
        print("\n🧪 Testing Config Testing...")
        
        # Test with a sample config
        test_config = "vless://example-uuid@example.com:443?type=tcp&security=tls#Example"
        
        success, response_data, status_code = self.run_request(
            "POST", 
            "/dashboard/test-config", 
            200, 
            {"config": test_config}
        )
        
        expected_fields = ["status", "message"]
        missing_fields = [field for field in expected_fields if field not in response_data]
        
        if success and not missing_fields:
            test_status = response_data.get("status")
            test_message = response_data.get("message")
            self.log_test_result("Test Config", True, f"Status: {test_status}, Message: {test_message}")
        else:
            error_msg = f"Missing fields: {missing_fields}" if missing_fields else "Request failed"
            self.log_test_result("Test Config", False, error_msg, 200, status_code)

    def test_worker_script(self):
        """Test worker script download"""
        print("\n💼 Testing Worker Script...")
        
        success, response_data, status_code = self.run_request("GET", "/dashboard/worker-script", 200)
        
        if success and "script" in response_data:
            script_content = response_data["script"]
            script_length = len(script_content)
            self.log_test_result("Get Worker Script", True, f"Script retrieved, length: {script_length} characters")
        else:
            self.log_test_result("Get Worker Script", False, "Missing script field", 200, status_code)

    def test_webhook_endpoint(self):
        """Test webhook endpoint"""
        print("\n🔗 Testing Webhook Endpoint...")
        
        # Test with a simple webhook payload
        test_webhook_payload = {
            "update_id": 123456,
            "message": {
                "message_id": 1,
                "from": {"id": 599762196, "is_bot": False, "first_name": "Test"},
                "chat": {"id": 599762196, "type": "private"},
                "date": 1640995200,
                "text": "/start"
            }
        }
        
        success, response_data, status_code = self.run_request(
            "POST", 
            "/webhook", 
            200, 
            test_webhook_payload
        )
        
        if success and response_data.get("ok") == True:
            self.log_test_result("Webhook Endpoint", True, "Webhook processed successfully")
        else:
            self.log_test_result("Webhook Endpoint", False, f"Webhook failed. Response: {response_data}", 200, status_code)

    def run_all_tests(self):
        """Run all tests in sequence"""
        print(f"🚀 Starting comprehensive API testing for VPN Bot Dashboard")
        print(f"📍 Base URL: {self.base_url}")
        print("=" * 60)
        
        # Authentication is required for most endpoints
        if not self.test_login():
            print("\n❌ Authentication failed - cannot proceed with other tests")
            return False
        
        # Test all dashboard endpoints
        self.test_dashboard_stats()
        self.test_source_links_management()
        self.test_channels_management()
        self.test_configs_list()
        self.test_templates_management()
        self.test_submissions()
        self.test_fetch_now()
        self.test_config_testing()
        self.test_worker_script()
        
        # Test webhook (doesn't require auth)
        self.test_webhook_endpoint()
        
        return True

    def print_summary(self):
        """Print test summary"""
        print("\n" + "=" * 60)
        print("📊 TEST SUMMARY")
        print("=" * 60)
        print(f"✅ Tests Passed: {self.tests_passed}")
        print(f"❌ Tests Failed: {len(self.failed_tests)}")
        print(f"📊 Total Tests: {self.tests_run}")
        print(f"📈 Success Rate: {(self.tests_passed/self.tests_run*100):.1f}%")
        
        if self.failed_tests:
            print(f"\n❌ Failed Tests:")
            for test in self.failed_tests:
                print(f"   - {test}")
        
        print("\n" + "=" * 60)

def main():
    """Main test execution"""
    print("🤖 VPN Config Bot API Tester")
    print("Testing Telegram Bot Dashboard APIs")
    
    tester = TelegramBotAPITester()
    
    try:
        tester.run_all_tests()
        tester.print_summary()
        
        # Return appropriate exit code
        success_rate = tester.tests_passed / tester.tests_run if tester.tests_run > 0 else 0
        return 0 if success_rate >= 0.8 else 1  # 80% pass rate required
        
    except KeyboardInterrupt:
        print("\n\n🛑 Testing interrupted by user")
        return 1
    except Exception as e:
        print(f"\n\n💥 Unexpected error during testing: {str(e)}")
        return 1

if __name__ == "__main__":
    sys.exit(main())