#!/usr/bin/env ruby
# Adapted from qrack code
# Soz it's a bit of a mess

require 'rubygems'
require 'nokogiri'
require 'erb'
require 'pathname'
require 'yaml'
require 'active_support'
require 'json'

class InputError < StandardError; end

def spec_details(doc)
  # AMQP spec details

  spec_details = {}

  root = doc.at('amqp')
  spec_details['major'] = root['major']
  spec_details['minor'] = root['minor']
  spec_details['revision'] = root['revision'] || '0'
  spec_details['port'] = root['port']
  spec_details['comment'] = root['comment'] || 'No comment'

  spec_details
end

def process_constants(doc)
  # AMQP constants

  frame_constants = {}
  other_constants = {}

  doc.xpath('//constant').each do |element|
    if element['name'].match(/^frame/)
      frame_constants[element['value'].to_i] =
      element['name'].sub(/^frame./,'').split(/\s|-/).map{|w| w.downcase.capitalize}.join
    else
      other_constants[element['value']] = element['name']
    end
  end

  [frame_constants.sort, other_constants.sort]
end

def domain_types(doc, major, minor, revision)
  # AMQP domain types

  dt_arr = []
  doc.xpath('amqp/domain').each do |element|
     dt_arr << element['type']
  end

  # Add domain types for specific document
  add_arr = add_types(major, minor, revision)
  type_arr = dt_arr + add_arr

  # Return sorted array
  type_arr.uniq.sort
end

def classes(doc, major, minor, revision)
  # AMQP classes

  cls_arr = []

  doc.xpath('amqp/class').each do |element|
    cls_hash = {}
    cls_hash[:name] = element['name']
    cls_hash[:index] = element['index']
    # Get fields for class
    field_arr = fields(doc, element)
    cls_hash[:fields] = field_arr
    # Get methods for class
    meth_arr = class_methods(doc, element)
    # Add missing methods
    add_arr =[]
    add_arr = add_methods(major, minor, revision) if cls_hash[:name] == 'queue'
    method_arr = meth_arr + add_arr
    # Add array to class hash
    cls_hash[:methods] = method_arr
    cls_arr << cls_hash
  end

  # Return class information array
  cls_arr
end

def class_methods(doc, cls)
  meth_arr = []

  # Get methods for class
  cls.xpath('./method').each do |method|
    meth_hash = {}
    meth_hash[:name] = method['name']
    meth_hash[:index] = method['index']
    # Get fields for method
    field_arr = fields(doc, method)
    meth_hash[:fields] = field_arr
    meth_arr << meth_hash
  end

  # Return methods
  meth_arr
end

def fields(doc, element)
  field_arr = []

  # Get fields for element
  element.xpath('./field').each do |field|
    field_hash = {}
    field_hash[:name] = field['name'].tr(' ', '-')
    field_hash[:domain] = field['type'] || field['domain']

    # Convert domain type if necessary
    conv_arr = convert_type(field_hash[:domain])
    field_hash[:domain] = conv_arr[field_hash[:domain]] unless conv_arr.empty?

    field_arr << field_hash
  end

  #  Return fields
  field_arr

end

def add_types(major, minor, revision)
  type_arr = []
  type_arr = ['long', 'longstr', 'octet', 'timestamp'] if (major == '8' and minor == '0' and revision == '0')
  type_arr
end

def add_methods(major, minor, revision)
  meth_arr = []

  if (major == '8' and minor == '0' and revision == '0')
    # Add Queue Unbind method
    meth_hash = {:name => 'unbind',
                 :index => '50',
                 :fields => [{:name => 'ticket', :domain => 'short'},
                             {:name => 'queue', :domain => 'shortstr'},
                             {:name => 'exchange', :domain => 'shortstr'},
                             {:name => 'routing_key', :domain => 'shortstr'},
                             {:name => 'arguments', :domain => 'table'}
                            ]
                }

    meth_arr << meth_hash

    # Add Queue Unbind-ok method
    meth_hash = {:name => 'unbind-ok',
                 :index => '51',
                 :fields => []
                }

    meth_arr << meth_hash
  end

  # Return methods
  meth_arr

end

def convert_type(name)
  type_arr = @type_conversion.reject {|k,v| k != name}
end

# Start of Main program

# Read in the spec file
doc = Nokogiri::XML(File.new(ARGV[0]))

# Declare type conversion hash
@type_conversion = {'path' => 'shortstr',
                    'known hosts' => 'shortstr',
                    'known-hosts' => 'shortstr',
                    'reply code' => 'short',
                    'reply-code' => 'short',
                    'reply text' => 'shortstr',
                    'reply-text' => 'shortstr',
                    'class id' => 'short',
                    'class-id' => 'short',
                    'method id' => 'short',
                    'method-id' => 'short',
                    'channel-id' => 'longstr',
                    'access ticket' => 'short',
                    'access-ticket' => 'short',
                    'exchange name' => 'shortstr',
                    'exchange-name' => 'shortstr',
                    'queue name' => 'shortstr',
                    'queue-name' => 'shortstr',
                    'consumer tag' => 'shortstr',
                    'consumer-tag' => 'shortstr',
                    'delivery tag' => 'longlong',
                    'delivery-tag' => 'longlong',
                    'redelivered' => 'bit',
                    'no ack' => 'bit',
                    'no-ack' => 'bit',
                    'no local' => 'bit',
                    'no-local' => 'bit',
                    'peer properties' => 'table',
                    'peer-properties' => 'table',
                    'destination' => 'shortstr',
                    'duration' => 'longlong',
                    'security-token' => 'longstr',
                    'reject-code' => 'short',
                    'reject-text' => 'shortstr',
                    'offset' => 'longlong',
                    'no-wait' => 'bit',
                    'message-count' => 'long'
                   }

# Spec details
spec_info = spec_details(doc)

# Constants
constants = process_constants(doc)

p "CONSTANTS"
p constants

# Frame constants
frame_constants = constants[0].select {|k,v| k <= 8}
frame_footer = constants[0].select {|k,v| v == 'End'}[0][0]

# Other constants
other_constants = constants[1]

# Domain types
data_types = domain_types(doc, spec_info['major'], spec_info['minor'], spec_info['revision'])

# Classes
class_defs = classes(doc, spec_info['major'], spec_info['minor'], spec_info['revision'])

p class_defs

def format_name(name)
  name.split('-').collect {|x| x.camelcase }.join
end

o = class_defs.inject({}) do |a, klass|
  a.update(klass[:name].camelcase => klass[:methods].inject({}) do |methods, method|
    methods.update(format_name(method[:name]) => [klass[:index].to_i, method[:index].to_i] + method[:fields].collect {|x| x[:domain] })
  end)
end
output = ERB.new(<<-EOS)
<% class_defs.each do |klass| %>
  <%= klass[:name].camelcase %> = {
    <% klass[:methods].each do |method| %>
      <%= method[:name] %> = <%= [klass[:index].to_i, method[:index].to_i].to_json %>,
    <% end %>
  }
<% end %>
EOS

File.open(File.dirname(__FILE__) + "/../lib/amqp/constants-generated.js", "w") do |f|
  f.puts "process.mixin(exports, #{o.to_json})"
end
